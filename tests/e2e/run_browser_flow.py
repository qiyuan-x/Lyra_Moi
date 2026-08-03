from __future__ import annotations

import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

try:
    from playwright.sync_api import sync_playwright
except ImportError as error:
    raise SystemExit(
        "Playwright is required. Run: python -m pip install -r tests/e2e/requirements.txt"
    ) from error


ROOT = Path(__file__).resolve().parents[2]
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)
PNG_BASE64 = base64.b64encode(PNG).decode("ascii")


class FakeProviderHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/v1/models":
            if self.headers.get("Authorization") != "Bearer e2e-secret":
                self._json(401, {"error": {"message": "invalid test API key"}})
                return
            self._json(
                200,
                {
                    "data": [
                        {"id": "fake-llm", "object": "model"},
                        {"id": "fake-image", "object": "model"},
                    ]
                },
            )
            return
        if self.path.rstrip("/") == "/v1/user/balance":
            if self.headers.get("Authorization") != "Bearer e2e-secret":
                self._json(401, {"code": 1004, "message": "invalid test API key"})
                return
            self._json(200, {"code": 0, "data": {"balance": 100}})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        if self.path.rstrip("/") == "/v1/chat/completions":
            if self.headers.get("Authorization") != "Bearer e2e-secret":
                self._json(401, {"error": {"message": "invalid test API key"}})
                return
            value = json.loads(body.decode("utf-8"))
            messages = value.get("messages", [])
            if any(message.get("role") == "tool" for message in messages):
                self._json(
                    200,
                    {"choices": [{"message": {"role": "assistant", "content": "图片生成完成"}}]},
                )
            else:
                self._json(
                    200,
                    {
                        "choices": [
                            {
                                "message": {
                                    "role": "assistant",
                                    "content": None,
                                    "tool_calls": [
                                        {
                                            "id": "e2e-image-call",
                                            "type": "function",
                                            "function": {
                                                "name": "generate_image",
                                                "arguments": json.dumps(
                                                    {"prompt": "生成端到端测试图片", "count": 1},
                                                    ensure_ascii=False,
                                                ),
                                            },
                                        }
                                    ],
                                }
                            }
                        ]
                    },
                )
            return
        if self.path.rstrip("/") in {"/v1/images/generations", "/v1/images/edits"}:
            if self.headers.get("Authorization") != "Bearer e2e-secret":
                self._json(401, {"error": {"message": "invalid test API key"}})
                return
            if self.path.rstrip("/") == "/v1/images/generations":
                value = json.loads(body.decode("utf-8"))
                if value.get("prompt") == "force-failure":
                    self._json(500, {"error": {"message": "forced image failure"}})
                    return
            time.sleep(1.0)
            self._json(200, {"data": [{"b64_json": PNG_BASE64}]})
            return
        self._json(404, {"error": "not found"})

    def log_message(self, _format: str, *_arguments: object) -> None:
        return

    def _json(self, status: int, value: object) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    validate_build()
    browser_executable = find_browser()
    node_executable = find_node()
    with tempfile.TemporaryDirectory(prefix="lyra-e2e-") as temporary:
        temporary_root = Path(temporary)
        data_directory = temporary_root / "data"
        first_image = temporary_root / "first.png"
        second_image = temporary_root / "second.png"
        first_image.write_bytes(PNG)
        second_image.write_bytes(PNG)

        provider = ThreadingHTTPServer(("127.0.0.1", 0), FakeProviderHandler)
        provider_thread = threading.Thread(target=provider.serve_forever, daemon=True)
        provider_thread.start()
        application_port = find_free_port()
        base_url = f"http://127.0.0.1:{application_port}"
        provider_url = f"http://127.0.0.1:{provider.server_port}/v1"
        api_stop = temporary_root / "api.stop"
        worker_stop = temporary_root / "worker.stop"
        environment = os.environ.copy()
        environment.update(
            {
                "LYRA_DEPLOYMENT_MODE": "desktop",
                "LYRA_DATA_DIR": str(data_directory),
                "LYRA_HOST": "127.0.0.1",
                "LYRA_PORT": str(application_port),
                "LYRA_WEB_DIST": str(ROOT / "apps" / "web" / "dist"),
                "LYRA_WORKER_VERSION": "0.1.0",
                "LYRA_AGENT_SYSTEM_PROMPT_FILE": str(
                    ROOT / "resources" / "prompts" / "agent-system-v1.txt"
                ),
            }
        )
        api_environment = {**environment, "LYRA_STOP_FILE": str(api_stop)}
        worker_environment = {**environment, "LYRA_STOP_FILE": str(worker_stop)}
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        api = subprocess.Popen(
            [str(node_executable), str(ROOT / "apps" / "api" / "dist" / "run.js")],
            cwd=ROOT,
            env=api_environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
        )
        worker: subprocess.Popen[bytes] | None = None

        try:
            wait_for_http(f"{base_url}/api/v1/health/live")
            worker = subprocess.Popen(
                [str(node_executable), str(ROOT / "apps" / "worker" / "dist" / "run.js")],
                cwd=ROOT,
                env=worker_environment,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creation_flags,
            )
            wait_for_http(f"{base_url}/api/v1/health/ready")
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    headless=True,
                    executable_path=str(browser_executable),
                )
                try:
                    configure_provider_from_ui(browser, base_url, provider_url)
                    run_browser_checks(browser, base_url, first_image, second_image)
                    run_android_layout_checks(browser, base_url)
                finally:
                    browser.close()
            verify_persisted_results(base_url)
            verify_project_directories(data_directory)
        finally:
            api_stop.touch(exist_ok=True)
            worker_stop.touch(exist_ok=True)
            if worker is not None:
                stop_process(worker)
            stop_process(api)
            provider.shutdown()
            provider.server_close()

    print("Browser flow passed: unified tasks, projects, asset separation, recovery, responsive UI.")
    return 0


def run_browser_checks(browser: Any, base_url: str, first_image: Path, second_image: Path) -> None:
    request_json(
        f"{base_url}/api/v1/prompts",
        method="POST",
        body={
            "name": "E2E Global Prompt",
            "category": "Character",
            "note": "Nano Banana works better",
            "content": "Keep the character identity.",
            "favorite": True,
        },
    )
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.goto(base_url, wait_until="domcontentloaded", timeout=15_000)
    page.locator(".app-shell").wait_for()
    page.get_by_role("button", name="发送", exact=True).wait_for()
    expect_equal(
        page.get_by_label("图片供应商", exact=True).locator("option").all_text_contents(),
        ["OpenAI 兼容", "E2E Backup Image"],
        "workspace image provider options",
    )
    expect_equal(
        page.get_by_label("图片模型", exact=True).locator("option").all_text_contents(),
        ["fake-image"],
        "workspace image model options",
    )
    page.get_by_label("图片供应商", exact=True).select_option(
        label="E2E Backup Image"
    )
    expect_equal(
        page.get_by_label("图片模型", exact=True).locator("option").all_text_contents(),
        ["fake-image"],
        "switched provider image models",
    )
    page.get_by_role("button", name="收起主菜单", exact=True).click()
    page.locator(".main-sidebar.collapsed").wait_for()
    page.get_by_role("button", name="展开主菜单", exact=True).click()
    page.locator(".main-sidebar:not(.collapsed)").wait_for()
    page.get_by_role("button", name="收起图片栏", exact=True).click()
    page.locator(".asset-rail.collapsed").wait_for()
    page.reload(wait_until="domcontentloaded")
    page.locator(".asset-rail.collapsed").wait_for()
    page.get_by_role("button", name="展开图片栏", exact=True).click()
    page.locator(".asset-rail:not(.collapsed)").wait_for()

    composer_files = page.locator(".composer input[type=file]")
    composer_files.set_input_files([str(first_image), str(second_image)])
    chips = page.locator(".attachment-chip")
    wait_for_count(chips, 2)
    upload_notice = page.locator(".notice-center .notice-success")
    upload_notice.wait_for()
    upload_notice.get_by_role("button", name="关闭通知", exact=True).click()
    wait_for_count(page.locator(".notice-center .notice"), 0)
    wait_for_count(page.locator(".asset-tile.selected"), 2)
    expect_equal(chips.locator("img").nth(0).get_attribute("alt"), "first", "first attachment")
    expect_equal(chips.locator("img").nth(1).get_attribute("alt"), "second", "second attachment")
    chips.nth(1).drag_to(chips.nth(0))
    expect_equal(chips.locator("img").nth(0).get_attribute("alt"), "second", "reordered attachment")
    expect_equal(page.locator(".asset-group").count(), 2, "separated asset rail groups")
    page.get_by_role("button", name="选择引用", exact=True).click()
    picker = page.get_by_role("dialog", name="选择引用图片")
    picker.wait_for()
    expect_equal(picker.locator(".asset-picker-item").count(), 2, "asset picker image count")
    picker.get_by_role("tab", name="上传素材", exact=True).click()
    expect_equal(picker.locator(".asset-picker-item").count(), 2, "asset picker upload filter")
    picker.locator(".asset-picker-search input").fill("first")
    expect_equal(picker.locator(".asset-picker-item").count(), 1, "asset picker search")
    save_screenshot(page, "asset-picker.png")
    picker.get_by_role("button", name="完成选择", exact=True).click()
    picker.wait_for(state="hidden")
    expect_equal(page.locator(".mode-switch").count(), 0, "legacy mode switch removed")
    prompt_mode = page.get_by_label("Agent 优化提示词", exact=True)
    expect_equal(prompt_mode.is_checked(), True, "Agent prompt optimization default")
    prompt_mode.press("Space")
    page.wait_for_function(
        "() => localStorage.getItem('lyra.agentOptimizeImagePrompt') === 'false'"
    )
    expect_equal(prompt_mode.is_checked(), False, "Agent prompt optimization disabled")
    page.locator(".prompt-menu > summary").click()
    page.locator(".prompt-menu-panel").get_by_role(
        "button", name="E2E Global Prompt"
    ).wait_for()
    expect_equal(
        page.locator(".prompt-menu-panel").get_by_text(
            "最近使用", exact=True
        ).count(),
        0,
        "composer recent prompts removed",
    )
    page.locator(".workspace-toolbar-primary").click()
    page.locator(".prompt-menu-panel").wait_for(state="hidden")
    save_screenshot(page, "generation-agent.png")

    page.locator(".composer textarea").fill("根据图一和图二生成测试图片")
    page.locator(".composer button[type=submit]").click()
    try:
        page.locator(".generation-flow-card").first.wait_for(timeout=15_000)
    except Exception:
        print(page.locator("body").inner_text(), file=sys.stderr)
        raise
    page.close()

    restored = browser.new_page(viewport={"width": 1440, "height": 960})
    restored.goto(base_url, wait_until="domcontentloaded", timeout=15_000)
    restored.locator(".generation-flow-card.status-succeeded").first.wait_for(timeout=30_000)
    expect_equal(restored.locator(".generation-flow-card").count(), 1, "conversation task flow count")
    expect_equal(restored.locator(".generation-flow-card .flow-input-node").count(), 2, "task input node count")
    expect_equal(restored.locator(".generation-flow-card .flow-connector").count(), 2, "task connector count")
    expect_equal(restored.locator(".generation-flow-card .output-image").count(), 1, "task output node count")
    restored.locator(".message-text", has_text="图片生成完成").wait_for(timeout=30_000)
    expect_equal(
        restored.locator(".message-list").evaluate(
            "(element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 2"
        ),
        True,
        "Agent message list default scroll",
    )
    conversation_bar = restored.locator(".conversation-bar")
    conversation_bar.wait_for()
    conversation_bar.locator(".conversation-select-trigger").click()
    conversation_bar.locator(".conversation-dropdown-menu article.active").get_by_title("重命名对话").click()
    conversation_bar.get_by_label("对话名称", exact=True).fill("角色方案对话")
    conversation_bar.get_by_role("button", name="保存对话名称", exact=True).click()
    conversation_bar.locator(".conversation-select-trigger").get_by_text("角色方案对话", exact=True).wait_for()
    save_screenshot(restored, "generation-conversations.png")
    restored.get_by_role("button", name="新建对话", exact=True).click()
    conversation_bar.locator(".conversation-select-trigger").click()
    wait_for_count(conversation_bar.locator(".conversation-dropdown-menu article"), 2)
    wait_for_count(restored.locator(".generation-flow-card"), 0)
    restored.get_by_text("当前工作区还没有生成任务", exact=True).wait_for()
    conversation_bar.locator(".conversation-dropdown-menu article.active").get_by_title("删除对话").click()
    restored.locator(".confirm-modal").get_by_role("button", name="确认删除", exact=True).click()
    conversation_bar.locator(".conversation-select-trigger").click()
    wait_for_count(conversation_bar.locator(".conversation-dropdown-menu article"), 1)
    wait_for_count(restored.locator(".generation-flow-card.status-succeeded"), 1)
    conversation_bar.locator(".conversation-select-trigger").click()
    restored.locator(".generation-flow-card.status-succeeded .output-image").first.click()
    wait_for_count(restored.locator(".attachment-chip"), 1)
    restored.locator(".composer textarea").fill("基于图一继续细化")
    restored.locator(".composer button[type=submit]").click()
    wait_for_count(restored.locator(".generation-flow-card.status-succeeded"), 2, timeout=30_000)
    restored.locator(".generation-flow-card").nth(1).get_by_text("来自任务 1", exact=True).wait_for()
    save_screenshot(restored, "generation-local-iteration.png")

    restored.get_by_role("button", name="新建任务", exact=True).click()
    restored.locator(".task-editor").wait_for()
    restored.get_by_text("新建生图任务", exact=True).wait_for()
    provider_select = restored.locator(".task-editor-fields select").nth(0)
    model_select = restored.locator(".task-editor-fields select").nth(1)
    selected_provider_label = provider_select.locator("option:checked").inner_text()
    selected_model_label = model_select.locator("option:checked").inner_text()
    expect_equal(
        " ".join(
            restored.locator(".task-editor-model-name").inner_text().split()
        ),
        f"当前模型： {selected_provider_label} / {selected_model_label}",
        "full task model name",
    )
    save_screenshot(restored, "task-editor.png")
    restored.get_by_role("button", name="取消", exact=True).click()
    restored.locator(".generation-flow-card").first.get_by_role(
        "button", name="编辑并重新创建", exact=True
    ).click()
    task_editor = restored.locator(".task-editor")
    task_editor.wait_for()
    expect_equal(task_editor.locator(".task-attachment-list article").count(), 2, "edited task inputs")
    task_editor.locator("textarea").first.fill("手动模式继续生成")
    task_editor.get_by_role("button", name="重新创建任务", exact=True).click()
    wait_for_count(restored.locator(".generation-flow-card.status-succeeded"), 3, timeout=30_000)
    restored.wait_for_function(
        """() => {
          const board = document.querySelector('.board-column');
          return board &&
            board.scrollTop + board.clientHeight >= board.scrollHeight - 2;
        }"""
    )
    restored.reload(wait_until="domcontentloaded")
    restored.locator(".generation-page.unified-workspace").wait_for()
    wait_for_count(restored.locator(".generation-flow-card.status-succeeded"), 3, timeout=15_000)
    restored.wait_for_function(
        """() => {
          const board = document.querySelector('.board-column');
          return board &&
            board.scrollTop + board.clientHeight >= board.scrollHeight - 2;
        }"""
    )

    restored.get_by_role("button", name="新建任务", exact=True).click()
    restored.locator(".task-editor textarea").first.fill("force-failure")
    restored.locator(".task-editor").get_by_role("button", name="创建任务", exact=True).click()
    failed_card = restored.locator(".generation-flow-card.status-failed")
    failed_card.wait_for(timeout=15_000)
    first_failed_job_id = failed_card.get_attribute("data-job-id")
    failed_card.get_by_role("button", name="重试", exact=True).click()
    restored.wait_for_function(
        """oldId => {
          const cards = [...document.querySelectorAll('.generation-flow-card.status-failed')];
          return cards.length === 1 && cards[0].dataset.jobId !== oldId;
        }""",
        arg=first_failed_job_id,
        timeout=15_000,
    )
    failed_card.get_by_role("button", name="移除", exact=True).click()
    wait_for_count(restored.locator(".generation-flow-card.status-failed"), 0)

    restored.get_by_role("button", name="新建任务", exact=True).click()
    restored.locator(".task-editor textarea").first.fill("force-failure")
    restored.locator(".task-editor").get_by_role("button", name="创建任务", exact=True).click()
    restored.locator(".generation-flow-card.status-failed").wait_for(timeout=15_000)
    restored.locator(".task-button").click()
    restored.locator(".task-drawer").get_by_role(
        "button", name="清理失败记录", exact=True
    ).click()
    wait_for_count(restored.locator(".generation-flow-card.status-failed"), 0)
    restored.get_by_role("button", name="关闭任务状态", exact=True).click()
    restored.get_by_role("button", name="素材库", exact=True).click()
    expect_equal(restored.locator(".asset-source-tabs button").count(), 2, "asset library source tabs")
    restored.locator(".asset-source-tabs button").nth(1).click()
    wait_for_count(restored.locator(".asset-library-grid article"), 3)
    restored.get_by_role("button", name="AI 建模", exact=True).click()
    restored.locator(".modeling-page").wait_for()
    restored.locator(".modeling-model-list-panel").wait_for()
    restored.get_by_text("创建建模任务后会显示在这里", exact=True).wait_for()
    restored.locator(".modeling-image-field-button").first.click()
    restored.locator(".asset-picker-dialog").wait_for()
    restored.get_by_role("tab", name="上传素材", exact=True).click()
    expect_equal(restored.locator(".asset-picker-item").count(), 2, "modeling upload inputs")
    restored.locator(".asset-picker-item").first.locator("button").first.click()
    restored.wait_for_function(
        "() => document.querySelectorAll('.modeling-model-picker option').length > 1",
        timeout=15_000,
    )
    expect_equal(
        sorted(restored.locator(".modeling-model-picker select option").all_text_contents()),
        sorted([
            "Tripo / Tripo P1",
            "Tripo / Tripo Turbo",
            "Tripo / Tripo v3.1",
            "Tripo / Tripo v3.0",
            "Tripo / Tripo v2.5",
        ]),
        "modeling model options",
    )
    restored.get_by_text("输出格式").first.wait_for()
    restored.get_by_text("GLB", exact=True).wait_for()
    restored.get_by_text("输入图自动修复", exact=True).wait_for()
    restored.get_by_text("自动对齐原图方向", exact=True).wait_for()
    assert_no_horizontal_overflow(restored, "desktop modeling")
    save_screenshot(restored, "modeling-empty.png")
    restored.get_by_role("button", name="图片生成", exact=True).click()
    exercise_project_management(restored)
    restored.locator(".main-sidebar nav button").nth(3).click()
    global_prompt = restored.locator(".prompt-list-row", has_text="E2E Global Prompt")
    global_prompt.wait_for()
    expect_equal(
        "Nano Banana works better" in global_prompt.locator(".prompt-model-note").inner_text(),
        True,
        "global prompt note",
    )
    expect_equal(
        global_prompt.locator(".favorite-button").get_attribute("aria-pressed"),
        "true",
        "global prompt favorite",
    )
    save_screenshot(restored, "generation-failure-cleanup.png")
    restored.close()


def exercise_project_management(page: Any) -> None:
    page.locator(".project-switcher-trigger").click()
    page.get_by_role("button", name="新建项目", exact=True).click()
    manager = page.locator(".project-manager")
    manager.wait_for()
    manager.get_by_label("项目名称", exact=True).fill("端到端独立项目")
    manager.get_by_label("项目描述", exact=True).fill("验证项目隔离")
    manager.get_by_role("button", name="创建项目", exact=True).click()
    page.get_by_text("当前工作区还没有生成任务", exact=True).wait_for(timeout=15_000)
    page.locator(".project-switcher-trigger").click()
    expect_equal(
        page.get_by_role("menuitemradio").count(),
        2,
        "created project option",
    )
    page.locator(".project-switcher-trigger").click()
    expect_equal(page.locator(".asset-tile").count(), 0, "new project asset isolation")

    page.get_by_role("button", name="管理项目", exact=True).click()
    manager = page.locator(".project-manager")
    manager.locator(".project-list > button", has_text="默认项目").click()
    manager.get_by_role("button", name="切换到此项目", exact=True).click()
    page.locator(".generation-flow-card.status-succeeded").first.wait_for(timeout=15_000)

    page.get_by_role("button", name="管理项目", exact=True).click()
    manager = page.locator(".project-manager")
    manager.locator(".project-list > button", has_text="端到端独立项目").click()
    manager.get_by_role("button", name="归档项目", exact=True).click()
    page.locator(".project-switcher-trigger").click()
    expect_equal(
        page.get_by_role("menuitemradio").count(),
        1,
        "archived project removed",
    )
    page.locator(".project-switcher-trigger").click()


def configure_provider_from_ui(browser: Any, base_url: str, provider_url: str) -> None:
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.goto(base_url, wait_until="domcontentloaded", timeout=15_000)
    page.locator(".app-shell").wait_for()
    page.get_by_role("button", name="设置", exact=True).click()
    expect_equal(page.get_by_role("button", name="关闭设置", exact=True).count(), 0, "settings close button")
    expect_equal(
        page.locator(".settings-provider-table > article").count(),
        4,
        "LLM provider preset count",
    )
    provider_rows = page.locator(".settings-provider-table > article")
    first_menu = provider_rows.nth(0).locator(".settings-provider-menu-trigger")
    second_menu = provider_rows.nth(1).locator(".settings-provider-menu-trigger")
    first_menu.click()
    expect_equal(
        page.locator(".settings-provider-menu > div").count(),
        1,
        "single provider menu after first click",
    )
    second_menu.click()
    expect_equal(first_menu.get_attribute("aria-expanded"), "false", "previous provider menu closed")
    expect_equal(
        page.locator(".settings-provider-menu > div").count(),
        1,
        "single provider menu after switching",
    )
    page.locator(".settings-overview-heading h2").click()
    expect_equal(
        page.locator(".settings-provider-menu > div").count(),
        0,
        "provider menu closes on outside click",
    )
    compatible_row = page.locator(
        ".settings-provider-name strong",
        has_text="OpenAI 兼容",
    ).locator("xpath=ancestor::article")
    compatible_row.locator(".settings-provider-menu-trigger").click()
    compatible_row.get_by_role("button", name="配置", exact=True).click()
    page.get_by_label("基础 URL", exact=True).fill(provider_url)
    page.locator(".settings-api-key-field input").fill("e2e-secret")
    expect_equal(page.get_by_role("button", name="保存连接", exact=True).count(), 0, "manual save button")
    page.get_by_role("button", name="连通性测试并更新模型", exact=True).click()
    page.locator(".connection-success").wait_for(timeout=15_000)
    model_select = page.locator(".settings-detail-default select")
    try:
        model_select.wait_for(timeout=15_000)
    except Exception:
        print(page.locator("body").inner_text(), file=sys.stderr)
        raise
    page.locator(".model-row", has_text="fake-llm").wait_for(timeout=15_000)
    expect_equal(
        model_select.locator("option").all_text_contents(),
        ["请选择模型", "fake-llm"],
        "filtered LLM models",
    )
    page.locator(".connection-success").wait_for(state="hidden", timeout=5_000)
    page.get_by_role("button", name="返回供应商列表", exact=True).click()
    compatible_row = page.locator(
        ".settings-provider-name strong",
        has_text="OpenAI 兼容",
    ).locator("xpath=ancestor::article")
    compatible_row.locator(".settings-provider-menu-trigger").click()
    compatible_row.get_by_role("button", name="修改配置", exact=True).wait_for()
    compatible_row.get_by_role("button", name="删除供应商", exact=True).wait_for()
    save_screenshot(page, "settings-provider-menu.png")

    page.get_by_role("button", name="AI 生图设置", exact=True).click()
    expect_equal(
        page.locator(".settings-provider-table > article").count(),
        3,
        "image provider preset count",
    )
    compatible_row = page.locator(
        ".settings-provider-name strong",
        has_text="OpenAI 兼容",
    ).locator("xpath=ancestor::article")
    compatible_row.locator(".settings-provider-menu-trigger").click()
    compatible_row.get_by_role("button", name="配置", exact=True).click()
    page.get_by_label("基础 URL", exact=True).fill(provider_url)
    page.locator(".settings-api-key-field input").fill("e2e-secret")
    page.get_by_role("button", name="连通性测试并更新模型", exact=True).click()
    page.locator(".connection-testing").wait_for()
    page.locator(".connection-success").wait_for(timeout=15_000)
    page.locator(".model-row", has_text="fake-image").wait_for(timeout=15_000)
    expect_equal(
        model_select.locator("option").all_text_contents(),
        ["请选择模型", "fake-image"],
        "filtered image models",
    )
    page.get_by_label("基础 URL", exact=True).fill(f"{provider_url}/")
    page.locator(".connection-saving").wait_for()
    page.locator(".connection-saved", has_text="修改已自动保存").wait_for(timeout=15_000)

    catalog = request_json(f"{base_url}/api/v1/providers")
    profiles = catalog["profiles"]
    expect_equal(len(profiles), 2, "configured provider count")
    expect_equal(
        {profile["serviceType"] for profile in profiles},
        {"llm", "image"},
        "provider service scopes",
    )
    expect_equal(len({profile["id"] for profile in profiles}), 2, "isolated provider profile IDs")
    for profile in profiles:
        expect_equal(profile["hasApiKey"], True, "OpenAI-compatible API key state")
        expect_equal(profile["baseUrl"], provider_url, "auto-saved normalized Base URL")
    save_screenshot(page, "settings-provider.png")
    page.get_by_role("button", name="AI 建模设置", exact=True).click()
    expect_equal(
        page.locator(".settings-provider-table > article").count(),
        3,
        "model provider preset count",
    )
    model_provider_text = page.locator(".settings-provider-table").inner_text()
    for provider_name in ("Meshy", "混元", "Tripo"):
        if provider_name not in model_provider_text:
            raise AssertionError(f"missing model provider preset: {provider_name}")
    tripo_row = page.locator(
        ".settings-provider-name strong",
        has_text="Tripo",
    ).locator("xpath=ancestor::article")
    tripo_row.locator(".settings-provider-menu-trigger").click()
    tripo_row.get_by_role("button", name="配置", exact=True).click()
    page.get_by_label("基础 URL", exact=True).fill(provider_url)
    page.locator(".settings-api-key-field input").fill("e2e-secret")
    page.get_by_role("button", name="连通性测试并更新模型", exact=True).click()
    page.locator(".connection-success").wait_for(timeout=15_000)
    page.locator(".model-row", has_text="Tripo P1").wait_for(timeout=15_000)
    expect_equal(
        sorted(page.locator(".settings-detail-default select option").all_text_contents()),
        sorted([
            "请选择模型",
            "Tripo P1",
            "Tripo Turbo",
            "Tripo v3.1",
            "Tripo v3.0",
            "Tripo v2.5",
        ]),
        "Tripo model catalog",
    )
    catalog = request_json(f"{base_url}/api/v1/providers")
    model_profiles = [
        profile for profile in catalog["profiles"] if profile["serviceType"] == "model"
    ]
    model_models = [
        model for model in catalog["models"] if model["serviceType"] == "model"
    ]
    expect_equal(len(model_profiles), 1, "configured model provider count")
    expect_equal(model_profiles[0]["enabled"], True, "configured model provider enabled")
    expect_equal(len(model_models), 5, "configured model catalog count")
    expect_equal(
        all(model["enabled"] for model in model_models),
        True,
        "configured model catalog enabled",
    )
    page.get_by_role("button", name="Agent 设置", exact=True).click()
    page.locator(".agent-prompt-settings").wait_for()
    prompt_fields = page.locator(".agent-prompt-field textarea")
    expect_equal(prompt_fields.count(), 3, "Agent prompt setting count")
    prompt_fields.nth(1).fill("E2E 自定义允许优化规则")
    prompt_fields.nth(1).blur()
    page.locator(".agent-prompt-save-state", has_text="已自动保存").wait_for(
        timeout=15_000
    )
    prompt_snapshot = request_json(
        f"{base_url}/api/v1/settings/agent-prompts"
    )
    expect_equal(
        prompt_snapshot["settings"]["optimizeEnabledPrompt"],
        "E2E 自定义允许优化规则",
        "saved Agent prompt setting",
    )
    page.get_by_role("button", name="全部恢复默认", exact=True).click()
    page.locator(".agent-prompt-save-state", has_text="已自动保存").wait_for(
        timeout=15_000
    )
    restored_prompts = request_json(
        f"{base_url}/api/v1/settings/agent-prompts"
    )
    expect_equal(
        restored_prompts["settings"],
        restored_prompts["defaults"],
        "restored Agent prompt defaults",
    )
    backup = request_json(
        f"{base_url}/api/v1/providers",
        method="POST",
        body={
            "serviceType": "image",
            "name": "E2E Backup Image",
            "protocol": "openai-compatible",
            "baseUrl": provider_url,
            "apiKey": "e2e-secret",
            "enabled": True,
        },
    )
    backup_id = backup["profile"]["id"]
    request_json(
        f"{base_url}/api/v1/providers/{backup_id}/test",
        method="POST",
    )
    refreshed_catalog = request_json(f"{base_url}/api/v1/providers")
    enabled_image_profiles = [
        profile
        for profile in refreshed_catalog["profiles"]
        if profile["serviceType"] == "image" and profile["enabled"]
    ]
    expect_equal(
        len(enabled_image_profiles),
        2,
        "multiple enabled image providers",
    )
    page.close()


def run_android_layout_checks(browser: Any, base_url: str) -> None:
    page = browser.new_page(
        viewport={"width": 412, "height": 915},
        is_mobile=True,
        has_touch=True,
        device_scale_factor=2,
    )
    page.goto(base_url, wait_until="domcontentloaded", timeout=15_000)
    page.locator(".app-shell").wait_for()
    expect_equal(page.locator(".sidebar-collapse-button").is_hidden(), True, "mobile sidebar toggle")
    page.locator(".project-switcher-trigger").click()
    page.get_by_role("button", name="新建项目", exact=True).wait_for()
    assert_no_horizontal_overflow(page, "mobile project switcher")
    page.locator(".project-switcher-trigger").click()
    assert_no_horizontal_overflow(page, "mobile generation")
    save_screenshot(page, "android-generation.png")
    page.locator(".generation-page.unified-workspace").wait_for()
    page.locator(".conversation-bar").wait_for()
    assert_no_horizontal_overflow(page, "mobile Agent conversation list")
    save_screenshot(page, "android-agent.png")
    page.get_by_role("button", name="新建任务", exact=True).click()
    page.locator(".task-editor").wait_for()
    assert_no_horizontal_overflow(page, "mobile task editor")
    save_screenshot(page, "android-task-editor.png")
    page.get_by_role("button", name="取消", exact=True).click()
    page.get_by_role("button", name="AI 建模", exact=True).click()
    page.locator(".modeling-page").wait_for()
    assert_no_horizontal_overflow(page, "mobile modeling")
    save_screenshot(page, "android-modeling.png")
    page.get_by_role("button", name="设置", exact=True).click()
    page.locator(".settings-window").wait_for()
    assert_no_horizontal_overflow(page, "mobile settings list")
    page.get_by_role("button", name="Agent 设置", exact=True).click()
    page.locator(".agent-prompt-settings").wait_for()
    assert_no_horizontal_overflow(page, "mobile Agent prompt settings")
    page.get_by_role("button", name="AI 生图设置", exact=True).click()
    compatible_row = page.locator(
        ".settings-provider-name strong",
        has_text="OpenAI 兼容",
    ).locator("xpath=ancestor::article")
    compatible_row.locator(".settings-provider-menu-trigger").click()
    compatible_row.get_by_role("button", name="修改配置", exact=True).click()
    page.locator(".settings-connection-editor").wait_for()
    assert_no_horizontal_overflow(page, "mobile settings detail")
    save_screenshot(page, "android-settings.png")
    page.close()


def assert_no_horizontal_overflow(page: Any, label: str) -> None:
    metrics = page.evaluate(
        "() => ({ viewport: document.documentElement.clientWidth, "
        "document: document.documentElement.scrollWidth })"
    )
    if metrics["document"] > metrics["viewport"] + 1:
        raise AssertionError(f"{label}: horizontal overflow {metrics!r}")


def verify_persisted_results(base_url: str) -> None:
    project = next(
        item
        for item in request_json(f"{base_url}/api/v1/projects")["items"]
        if item["name"] == "默认项目"
    )
    jobs = request_json(f"{base_url}/api/v1/jobs?projectId={project['id']}&limit=20")["items"]
    succeeded = [job for job in jobs if job["status"] == "succeeded"]
    expect_equal(len(succeeded), 3, "succeeded job count")
    expect_equal({job["source"] for job in succeeded}, {"agent", "manual"}, "job sources")
    agent_jobs = sorted(
        [job for job in succeeded if job["source"] == "agent"],
        key=lambda item: item["createdAt"],
    )
    expect_equal(agent_jobs[0]["prompt"], "根据图一和图二生成测试图片", "raw Agent image prompt")
    expect_equal(
        agent_jobs[1]["inputs"][0]["assetId"],
        agent_jobs[0]["outputs"][0]["assetId"],
        "local task provenance",
    )
    assets = request_json(f"{base_url}/api/v1/projects/{project['id']}/assets?limit=20")["items"]
    generated = [asset for asset in assets if asset["source"] == "generated"]
    expect_equal(len(generated), 3, "generated assets")


def verify_project_directories(data_directory: Path) -> None:
    project_roots = [path for path in (data_directory / "projects").iterdir() if path.is_dir()]
    expect_equal(len(project_roots), 2, "project data directory count")
    for project_root in project_roots:
        for relative in (
            Path("uploads/images"),
            Path("uploads/thumbnails"),
            Path("generated/images"),
            Path("generated/thumbnails"),
            Path("generated/models"),
            Path("temp"),
        ):
            if not (project_root / relative).is_dir():
                raise AssertionError(f"missing project directory: {project_root / relative}")


def request_json(url: str, method: str = "GET", body: object | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json; charset=utf-8"} if data else {},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_http(url: str, timeout: float = 20.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            time.sleep(0.1)
    raise RuntimeError(f"Service did not become ready: {url}")


def wait_for_count(locator: Any, count: int, timeout: int = 15_000) -> None:
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if locator.count() == count:
            return
        time.sleep(0.1)
    raise AssertionError(f"Expected {count} elements, found {locator.count()}")


def stop_process(process: subprocess.Popen[bytes]) -> None:
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()


def validate_build() -> None:
    required = [
        ROOT / "apps" / "api" / "dist" / "run.js",
        ROOT / "apps" / "worker" / "dist" / "run.js",
        ROOT / "apps" / "web" / "dist" / "index.html",
    ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise SystemExit(f"Production build is missing: {', '.join(missing)}. Run pnpm build first.")


def find_node() -> Path:
    configured = os.environ.get("LYRA_NODE_EXECUTABLE", "").strip()
    candidates = [configured]
    if os.name == "nt":
        candidates.append(
            str(
                Path.home()
                / ".cache"
                / "codex-runtimes"
                / "codex-primary-runtime"
                / "dependencies"
                / "node"
                / "bin"
                / "node.exe"
            )
        )
    candidates.append(shutil.which("node") or "")
    checked: set[str] = set()
    for candidate in candidates:
        executable = Path(candidate) if candidate else None
        if executable is None or not executable.is_file():
            continue
        key = str(executable.resolve()).lower()
        if key in checked:
            continue
        checked.add(key)
        result = subprocess.run(
            [str(executable), "--version"],
            capture_output=True,
            text=True,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        try:
            major = int(result.stdout.strip().lstrip("v").split(".", 1)[0])
        except (ValueError, IndexError):
            continue
        if result.returncode == 0 and major >= 22:
            return executable
    raise SystemExit("Node.js 22.19 or newer was not found. Set LYRA_NODE_EXECUTABLE.")


def find_browser() -> Path:
    configured = os.environ.get("LYRA_E2E_BROWSER", "").strip()
    candidates = [configured]
    if os.name == "nt":
        candidates.extend(
            [
                r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            ]
        )
    else:
        candidates.extend(filter(None, [shutil.which("chromium"), shutil.which("google-chrome")]))
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    raise SystemExit("Chromium, Edge, or Chrome was not found. Set LYRA_E2E_BROWSER.")


def find_free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def expect_equal(actual: object, expected: object, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def save_screenshot(page: Any, name: str) -> None:
    configured = os.environ.get("LYRA_E2E_SCREENSHOT_DIR", "").strip()
    if not configured:
        return
    directory = Path(configured)
    directory.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(directory / name), full_page=True)


if __name__ == "__main__":
    raise SystemExit(main())
