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
                    run_community_checks(browser, base_url)
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


def run_community_checks(browser: Any, base_url: str) -> None:
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.goto(base_url, wait_until="domcontentloaded", timeout=15_000)
    page.locator(".app-shell").wait_for()

    page.get_by_role("button", name="其他功能", exact=True).click()
    page.get_by_role("button", name="社区", exact=True).click()
    community_frame = page.locator("iframe.community-frame")
    community_frame.wait_for()
    expect_equal(
        community_frame.get_attribute("src"),
        "https://linfrsot.cloud/lyra/community/",
        "default community URL is configured",
    )

    page.get_by_role("button", name="设置", exact=True).click()
    page.get_by_role("button", name="社区设置", exact=True).click()
    community_url = f"{base_url}/community-target"
    page.locator(".community-settings-form input").fill(community_url)
    page.get_by_role("button", name="保存", exact=True).click()
    page.get_by_text("已保存", exact=True).wait_for()

    page.get_by_role("button", name="其他功能", exact=True).click()
    page.get_by_role("button", name="社区", exact=True).click()
    community_frame = page.locator("iframe.community-frame")
    community_frame.wait_for()
    expect_equal(
        community_frame.get_attribute("src"),
        community_url,
        "community is embedded in the Lyra page",
    )
    with page.expect_popup() as popup_info:
        page.get_by_role("button", name="在新窗口打开 ↗", exact=True).click()
    popup = popup_info.value
    popup.wait_for_url(f"{community_url}*")
    expect_equal(
        popup.url.startswith(community_url),
        True,
        "community can also open in a new browser window",
    )
    popup.close()
    page.close()


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
    page.get_by_role("button", name="对话", exact=True).click()
    page.get_by_role("button", name="发送", exact=True).wait_for()
    project = next(
        item
        for item in request_json(f"{base_url}/api/v1/projects")["items"]
        if item["name"] == "默认项目"
    )
    expect_equal(
        len(request_json(
            f"{base_url}/api/v1/projects/{project['id']}/conversations"
        )["items"]),
        0,
        "blank draft is not persisted before first message",
    )
    page.get_by_role("button", name="选择生图供应商和模型", exact=True).click()
    expect_equal(
        page.get_by_label("生图供应商", exact=True).locator("option").all_text_contents(),
        ["E2E Image", "E2E Backup Image"],
        "workspace image provider options",
    )
    expect_equal(
        page.get_by_label("生图模型", exact=True).locator("option").all_text_contents(),
        ["fake-image"],
        "workspace image model options",
    )
    page.get_by_label("生图供应商", exact=True).select_option(
        label="E2E Backup Image"
    )
    expect_equal(
        page.get_by_label("生图模型", exact=True).locator("option").all_text_contents(),
        ["fake-image"],
        "switched provider image models",
    )
    page.get_by_role("button", name="选择建模供应商和模型", exact=True).click()
    expect_equal(page.get_by_label("建模供应商", exact=True).count(), 1, "Agent model provider select")
    expect_equal(page.get_by_label("建模模型", exact=True).count(), 1, "Agent model select")
    page.get_by_role("button", name="选择建模供应商和模型", exact=True).click()
    page.get_by_role("button", name="收起主菜单", exact=True).click()
    page.locator(".main-sidebar.collapsed").wait_for()
    page.get_by_role("button", name="展开主菜单", exact=True).click()
    page.locator(".main-sidebar:not(.collapsed)").wait_for()
    expect_equal(page.locator(".conversation-page .asset-rail").count(), 0, "conversation asset rail removed")

    composer_files = page.locator(".composer input[type=file]")
    composer_files.set_input_files([str(first_image), str(second_image)])
    chips = page.locator(".attachment-chip")
    wait_for_count(chips, 2)
    wait_for_count(page.locator(".notice-center .notice"), 0)
    expect_equal(chips.locator("img").nth(0).get_attribute("alt"), "first", "first attachment")
    expect_equal(chips.locator("img").nth(1).get_attribute("alt"), "second", "second attachment")
    chips.nth(1).drag_to(chips.nth(0))
    expect_equal(chips.locator("img").nth(0).get_attribute("alt"), "second", "reordered attachment")
    page.locator(".composer").get_by_role("button", name="素材库", exact=True).click()
    picker = page.get_by_role("dialog", name="选择对话素材")
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
    expect_equal(
        page.get_by_label("Agent 优化提示词", exact=True).count(),
        0,
        "Agent prompt optimization switch removed",
    )
    page.locator(".composer").get_by_role("button", name="提示词库", exact=True).click()
    page.locator(".prompt-template-popover").get_by_text(
        "E2E Global Prompt", exact=True
    ).wait_for()
    expect_equal(
        page.locator(".prompt-template-popover").get_by_text(
            "最近使用", exact=True
        ).count(),
        0,
        "composer recent prompts removed",
    )
    page.locator(".workspace-toolbar").click(position={"x": 8, "y": 8})
    page.locator(".prompt-template-popover").wait_for(state="hidden")
    save_screenshot(page, "generation-agent.png")

    page.locator(".composer textarea").fill("根据图一和图二生成测试图片")
    page.locator(".composer button[type=submit]").click()
    try:
        page.locator(".generation-flow-card").first.wait_for(timeout=15_000)
    except Exception:
        print(page.locator("body").inner_text(), file=sys.stderr)
        raise
    expect_equal(
        len(request_json(
            f"{base_url}/api/v1/projects/{project['id']}/conversations"
        )["items"]),
        1,
        "first message persists the draft conversation",
    )
    page.close()

    restored = browser.new_page(viewport={"width": 1440, "height": 960})
    restored.goto(base_url, wait_until="domcontentloaded", timeout=15_000)
    restored.get_by_role("button", name="对话", exact=True).click()
    restored.locator(".generation-flow-card.status-succeeded").first.wait_for(timeout=30_000)
    expect_equal(restored.locator(".generation-flow-card").count(), 1, "conversation task flow count")
    expect_equal(restored.locator(".generation-flow-card .flow-input-node").count(), 2, "task input node count")
    expect_equal(restored.locator(".generation-flow-card .flow-connector").count(), 2, "task connector count")
    expect_equal(restored.locator(".generation-flow-card .output-image").count(), 1, "task output node count")
    restored.locator(".generation-flow-card .job-elapsed-time", has_text="耗时").wait_for()
    restored.locator(".generation-flow-card .output-image-info", has_text="PNG").wait_for()
    restored.locator(".message-text", has_text="图片生成完成").wait_for(timeout=30_000)
    expect_equal(
        restored.locator(".message-list").evaluate(
            "(element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 2"
        ),
        True,
        "Agent message list default scroll",
    )
    sidebar_conversations = restored.locator(".sidebar-conversation-subtree")
    sidebar_conversations.wait_for()
    active_conversation = sidebar_conversations.locator(".sidebar-conversation-item.active")
    active_conversation.get_by_title("对话操作").click()
    restored.get_by_role("menu", name="对话操作").get_by_role(
        "menuitem", name="重命名", exact=True
    ).click()
    active_conversation.get_by_label("对话名称", exact=True).fill("角色方案对话")
    active_conversation.get_by_role("button", name="保存对话名称", exact=True).click()
    sidebar_conversations.get_by_text("角色方案对话", exact=True).wait_for()
    save_screenshot(restored, "generation-conversations.png")
    sidebar_conversations.get_by_role("button", name="新对话", exact=True).click()
    wait_for_count(sidebar_conversations.locator(".sidebar-conversation-item"), 1)
    sidebar_conversations.locator(".sidebar-new-conversation.active").wait_for()
    draft_conversations = request_json(
        f"{base_url}/api/v1/projects/{project['id']}/conversations"
    )["items"]
    expect_equal(
        len(draft_conversations),
        1,
        "new conversation remains a draft before sending",
    )
    request_json(
        f"{base_url}/api/v1/conversations/{draft_conversations[0]['id']}",
        method="PATCH",
        body={"title": "角色方案对话"},
    )
    restored.wait_for_timeout(750)
    expect_equal(
        sidebar_conversations.locator(".sidebar-conversation-item.active").count(),
        0,
        "background refresh keeps the new conversation draft active",
    )
    sidebar_conversations.locator(".sidebar-new-conversation.active").wait_for()
    wait_for_count(restored.locator(".generation-flow-card"), 0)
    restored.get_by_text("当前工作区还没有生成任务", exact=True).wait_for()
    sidebar_conversations.locator(
        ".sidebar-conversation-open", has_text="角色方案对话"
    ).click()
    wait_for_count(restored.locator(".generation-flow-card.status-succeeded"), 1)
    active_conversation = sidebar_conversations.locator(".sidebar-conversation-item.active")
    active_conversation.get_by_title("对话操作").click()
    restored.get_by_role("menu", name="对话操作").get_by_role(
        "menuitem", name="删除", exact=True
    ).click()
    restored.locator(".confirm-modal").get_by_role("button", name="取消", exact=True).click()
    wait_for_count(restored.locator(".generation-flow-card.status-succeeded"), 1)
    wait_for_count(sidebar_conversations.locator(".sidebar-conversation-item"), 1)
    restored.locator(".generation-flow-card.status-succeeded .output-image").first.click()
    wait_for_count(restored.locator(".attachment-chip"), 1)
    restored.locator(".composer textarea").fill("基于图一继续细化")
    restored.locator(".composer button[type=submit]").click()
    wait_for_count(restored.locator(".generation-flow-card.status-succeeded"), 2, timeout=30_000)
    restored.locator(".generation-flow-card").nth(1).get_by_text("来自任务 1", exact=True).wait_for()
    save_screenshot(restored, "generation-local-iteration.png")

    restored.get_by_role("button", name="图片生成", exact=True).click()
    image_page = restored.locator(".image-generation-page")
    image_panel = restored.locator(".image-generation-panel")
    image_panel.wait_for()
    expect_equal(image_page.locator(".task-button").count(), 0, "image task status button removed")
    image_page.get_by_role("button", name="收起图片栏", exact=True).click()
    image_page.locator(".asset-rail.collapsed").wait_for()
    restored.reload(wait_until="domcontentloaded")
    image_page = restored.locator(".image-generation-page")
    image_panel = restored.locator(".image-generation-panel")
    image_panel.wait_for()
    image_page.locator(".asset-rail.collapsed").wait_for()
    image_page.get_by_role("button", name="展开图片栏", exact=True).click()
    image_page.locator(".asset-rail:not(.collapsed)").wait_for()
    provider_select = image_page.get_by_label("图片供应商", exact=True)
    model_select = image_page.get_by_label("图片模型", exact=True)
    selected_provider_label = provider_select.locator("option:checked").inner_text()
    selected_model_label = model_select.locator("option:checked").inner_text()
    expect_equal(
        bool(selected_provider_label and selected_model_label),
        True,
        "image provider and model selected",
    )
    expect_equal(
        image_page.get_by_role("button", name="选择引用", exact=True).count(),
        0,
        "manual image rail duplicate picker removed",
    )
    image_panel.get_by_role("button", name="提示词库", exact=True).click()
    prompt_popover = restored.locator(".prompt-template-popover")
    prompt_popover.wait_for()
    expect_equal(
        prompt_popover.evaluate(
            """element => {
              const rect = element.getBoundingClientRect();
              return rect.left >= 0 && rect.right <= window.innerWidth &&
                rect.top >= 0 && rect.bottom <= window.innerHeight;
            }"""
        ),
        True,
        "manual prompt popover in viewport",
    )
    restored.keyboard.press("Escape")
    prompt_popover.wait_for(state="hidden")
    image_panel.locator("textarea").first.fill("手动模式生成图片")
    image_panel.get_by_role("button", name="生成图片", exact=True).click()
    wait_for_count(restored.locator(".generation-flow-card.status-succeeded"), 1, timeout=30_000)
    expect_equal(restored.locator(".mobile-generation-jobs-button").is_hidden(), True, "desktop generation records button hidden")
    expect_equal(restored.locator(".mobile-task-toggle").first.is_hidden(), True, "desktop image task collapse hidden")
    save_screenshot(restored, "image-generation-page.png")
    restored.locator(".generation-flow-card").first.get_by_role(
        "button", name="编辑并重新创建", exact=True
    ).click()
    image_panel.get_by_text("编辑并重新生成", exact=True).wait_for()
    image_panel.locator("textarea").first.fill("手动模式继续生成")
    image_panel.get_by_role("button", name="重新生成", exact=True).click()
    wait_for_count(restored.locator(".generation-flow-card.status-succeeded"), 2, timeout=30_000)
    restored.wait_for_function(
        """() => {
          const board = document.querySelector('.board-column');
          return board &&
            board.scrollTop + board.clientHeight >= board.scrollHeight - 2;
        }"""
    )
    restored.reload(wait_until="domcontentloaded")
    restored.locator(".image-generation-page").wait_for()
    wait_for_count(restored.locator(".generation-flow-card.status-succeeded"), 2, timeout=15_000)
    restored.wait_for_function(
        """() => {
          const board = document.querySelector('.board-column');
          return board &&
            board.scrollTop + board.clientHeight >= board.scrollHeight - 2;
        }"""
    )

    image_panel = restored.locator(".image-generation-panel")
    image_panel.locator("textarea").first.fill("force-failure")
    image_panel.get_by_role("button", name="生成图片", exact=True).click()
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

    image_panel.locator("textarea").first.fill("force-failure")
    image_panel.get_by_role("button", name="生成图片", exact=True).click()
    failed_card = restored.locator(".generation-flow-card.status-failed")
    failed_card.wait_for(timeout=15_000)
    failed_card.get_by_role("button", name="移除", exact=True).click()
    wait_for_count(restored.locator(".generation-flow-card.status-failed"), 0)
    restored.get_by_role("button", name="素材库", exact=True).click()
    expect_equal(restored.locator(".asset-source-tabs button").count(), 3, "asset library source tabs")
    expect_equal(restored.locator(".asset-source-divider").count(), 1, "model asset separator")
    restored.locator(".asset-source-tabs button").nth(1).click()
    wait_for_count(restored.locator(".asset-library-grid article"), 4)
    restored.locator(".asset-source-tabs button").nth(2).click()
    restored.get_by_text("没有符合条件的 AI 模型", exact=True).wait_for()
    expect_equal(restored.get_by_role("button", name="上传图片", exact=True).count(), 0, "model library has no upload")
    save_screenshot(restored, "asset-library-models-empty.png")
    restored.get_by_role("button", name="提示词库", exact=True).click()
    restored.locator(".prompt-library-page").wait_for()
    restored.get_by_text("E2E Global Prompt", exact=True).wait_for()
    save_screenshot(restored, "prompt-library.png")
    restored.get_by_role("button", name="AI 建模", exact=True).click()
    restored.locator(".modeling-page").wait_for()
    restored.locator(".modeling-model-list-panel").wait_for()
    expect_equal(
        restored.locator(".modeling-model-list-toggle").is_hidden(),
        True,
        "desktop model list toggle hidden",
    )
    restored.get_by_text("创建建模任务后会显示在这里", exact=True).wait_for()
    restored.locator(".modeling-image-field-button").first.click()
    restored.locator(".asset-picker-dialog").wait_for()
    restored.get_by_role("tab", name="上传素材", exact=True).click()
    expect_equal(restored.locator(".asset-picker-item").count(), 2, "modeling upload inputs")
    restored.locator(".asset-picker-item").first.locator("button").first.click()
    clear_model_input = restored.get_by_role("button", name="清除模型输入图", exact=True)
    clear_model_input.wait_for()
    clear_model_input.click()
    expect_equal(restored.locator(".modeling-image-field-button img").count(), 0, "cleared model input")
    restored.evaluate(
        """(png) => {
            const bytes = Uint8Array.from(atob(png), (value) => value.charCodeAt(0));
            const file = new File([bytes], 'pasted-model.png', { type: 'image/png' });
            const transfer = new DataTransfer();
            transfer.items.add(file);
            document.dispatchEvent(new ClipboardEvent('paste', {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true
            }));
        }""",
        PNG_BASE64,
    )
    restored.locator(".modeling-image-field-button img").wait_for(timeout=15_000)
    restored.get_by_role("button", name="清除模型输入图", exact=True).click()
    restored.evaluate(
        """(png) => {
            const bytes = Uint8Array.from(atob(png), (value) => value.charCodeAt(0));
            const file = new File([bytes], 'dropped-model.png', { type: 'image/png' });
            const transfer = new DataTransfer();
            transfer.items.add(file);
            const field = document.querySelector('.modeling-image-field');
            field.dispatchEvent(new DragEvent('dragenter', {
                dataTransfer: transfer,
                bubbles: true,
                cancelable: true
            }));
            field.dispatchEvent(new DragEvent('drop', {
                dataTransfer: transfer,
                bubbles: true,
                cancelable: true
            }));
        }""",
        PNG_BASE64,
    )
    restored.locator(".modeling-image-field-button img").wait_for(timeout=15_000)
    restored.wait_for_function(
        "() => document.querySelectorAll('.modeling-model-picker select').length === 2",
        timeout=15_000,
    )
    expect_equal(
        sorted(restored.get_by_label("建模模型", exact=True).locator("option").all_text_contents()),
        sorted([
            "Tripo P1",
            "Tripo Turbo",
            "Tripo v3.1",
            "Tripo v3.0",
            "Tripo v2.5",
        ]),
        "modeling model options",
    )
    restored.get_by_text("输出格式").first.wait_for()
    restored.get_by_text("GLB", exact=True).wait_for()
    restored.get_by_text("输入图自动修复", exact=True).wait_for()
    restored.get_by_text("自动对齐原图方向", exact=True).wait_for()
    restored.get_by_role("tab", name="文字生成", exact=True).click()
    restored.locator(".modeling-text-prompt textarea").fill("a low poly spaceship")
    assert_no_horizontal_overflow(restored, "desktop modeling")
    save_screenshot(restored, "modeling-empty.png")
    restored.get_by_role("button", name="其他功能", exact=True).click()
    restored.get_by_role("button", name="动作参考", exact=True).click()
    restored.locator(".pose-studio-page").wait_for()
    restored.locator(".pose-editor-canvas").wait_for()
    restored.locator(".pose-model-state").wait_for(state="hidden", timeout=20_000)
    expect_equal(
        restored.locator(".pose-body-template").count() >= 3,
        True,
        "pose studio built-in templates",
    )
    restored.locator(".pose-body-template").nth(0).click()
    save_screenshot(restored, "pose-template-t.png")
    restored.locator(".pose-body-template").nth(1).click()
    save_screenshot(restored, "pose-template-a.png")
    restored.locator(".pose-body-template").nth(2).click()
    restored.locator(".pose-hand-template", has_text="握拳").get_by_role("button", name="左手", exact=True).click()
    save_screenshot(restored, "pose-hand-fist.png")
    restored.locator(".pose-hand-template", has_text="张开").get_by_role("button", name="左手", exact=True).click()
    restored.locator(".pose-control-panel select").first.select_option("quinn")
    restored.locator(".pose-model-state").wait_for(state="hidden", timeout=20_000)
    save_screenshot(restored, "pose-quinn.png")
    restored.locator(".pose-control-panel select").first.select_option("manny")
    restored.locator(".pose-model-state").wait_for(state="hidden", timeout=20_000)
    restored.get_by_role("button", name="保存截图", exact=True).wait_for()
    assert_no_horizontal_overflow(restored, "desktop pose studio")
    save_screenshot(restored, "pose-studio.png")
    restored.get_by_role("button", name="保存截图", exact=True).click()
    wait_for_count(restored.locator(".notice-center .notice"), 0)
    restored.get_by_role("button", name="图片生成", exact=True).click()
    exercise_project_management(restored)
    restored.locator(".main-sidebar").get_by_role(
        "button", name="提示词库", exact=True
    ).click()
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
    global_prompt.get_by_role("button", name="编辑 E2E Global Prompt", exact=True).click()
    prompt_dialog = restored.locator(".prompt-form-modal")
    prompt_dialog.wait_for()
    prompt_dialog.get_by_role("button", name="选择效果图", exact=True).click()
    preview_picker = restored.locator(".prompt-preview-picker")
    preview_picker.wait_for()
    expect_equal(
        preview_picker.locator(".prompt-preview-option img").count() > 0,
        True,
        "prompt preview picker thumbnails",
    )
    assert_no_horizontal_overflow(restored, "desktop prompt preview picker")
    save_screenshot(restored, "prompt-preview-picker.png")
    preview_picker.locator(".prompt-preview-option:has(img)").first.click()
    preview_picker.get_by_role("button", name="确定", exact=True).click()
    expect_equal(
        prompt_dialog.locator(".prompt-preview-trigger img").count(),
        1,
        "selected prompt preview thumbnail",
    )
    prompt_dialog.get_by_role("button", name="取消", exact=True).click()
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

    page.get_by_role("button", name="项目设置", exact=True).click()
    manager = page.locator(".project-manager")
    manager.locator(".project-list > button", has_text="默认项目").click()
    manager.get_by_role("button", name="切换到此项目", exact=True).click()
    page.locator(".generation-flow-card.status-succeeded").first.wait_for(timeout=15_000)

    page.get_by_role("button", name="项目设置", exact=True).click()
    manager = page.locator(".project-manager")
    manager.locator(".project-list > button", has_text="端到端独立项目").click()
    manager.get_by_role("button", name="删除项目", exact=True).click()
    page.locator(".confirm-modal").get_by_role("button", name="确认删除", exact=True).click()
    page.locator(".project-switcher-trigger").click()
    expect_equal(
        page.get_by_role("menuitemradio").count(),
        1,
        "deleted project removed",
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
        3,
        "starter LLM provider list",
    )
    expect_equal(
        page.locator(".settings-provider-table > article .settings-provider-name strong").all_text_contents(),
        ["OpenAI", "Gemini", "FrostAPI"],
        "starter LLM provider order",
    )
    starter_openai = page.locator(".settings-provider-table > article").first
    starter_openai.locator(".settings-provider-menu-trigger").click()
    starter_openai.get_by_role("button", name="删除供应商", exact=True).wait_for()
    page.locator(".settings-overview-heading h2").click()
    page.get_by_role("button", name="添加供应商", exact=True).click()
    expect_equal(
        page.locator(".provider-picker-item").count(),
        12,
        "all LLM provider choices",
    )
    page.locator(".provider-picker-item", has_text="自定义连接").click()
    page.get_by_label("供应商名称", exact=True).fill("E2E LLM")
    page.get_by_label("基础 URL", exact=True).fill(provider_url)
    page.locator(".settings-api-key-field input").fill("e2e-secret")
    expect_equal(page.get_by_role("button", name="保存连接", exact=True).count(), 0, "manual save button")
    page.get_by_role("button", name="连通性测试并更新模型", exact=True).click()
    try:
        page.locator(".connection-success").wait_for(timeout=15_000)
    except Exception:
        print(page.locator(".connection-result").all_text_contents(), file=sys.stderr)
        raise
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
        has_text="E2E LLM",
    ).locator("xpath=ancestor::article")
    compatible_row.locator(".settings-provider-menu-trigger").click()
    compatible_row.get_by_role("button", name="修改配置", exact=True).wait_for()
    compatible_row.get_by_role("button", name="删除供应商", exact=True).wait_for()
    save_screenshot(page, "settings-provider-menu.png")

    page.get_by_role("button", name="AI 生图设置", exact=True).click()
    expect_equal(
        page.locator(".settings-provider-table > article").count(),
        3,
        "starter image provider list",
    )
    page.get_by_role("button", name="添加供应商", exact=True).click()
    page.locator(".provider-picker-item", has_text="自定义连接").click()
    page.get_by_label("供应商名称", exact=True).fill("E2E Image")
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
    guide_position = page.evaluate(
        """() => {
          const models = document.querySelector('.settings-model-section');
          const guide = document.querySelector('.settings-api-guide-section');
          if (!models || !guide) return null;
          const style = getComputedStyle(guide);
          return {
            modelsTop: models.getBoundingClientRect().top,
            guideTop: guide.getBoundingClientRect().top,
            borderTopWidth: style.borderTopWidth
          };
        }"""
    )
    if not guide_position or guide_position["guideTop"] <= guide_position["modelsTop"]:
        raise AssertionError(f"API Key guide is not at the bottom: {guide_position!r}")
    if guide_position["borderTopWidth"] == "0px":
        raise AssertionError("API Key guide separator is missing")
    page.get_by_label("基础 URL", exact=True).fill(f"{provider_url}/")
    page.locator(".connection-saving").wait_for()
    page.locator(".connection-saved", has_text="修改已自动保存").wait_for(timeout=15_000)

    enable_switch = page.locator(".settings-enable-control input[type=checkbox]")
    page.locator(".settings-enable-control .switch").click()
    expect_equal(enable_switch.is_checked(), False, "provider switch unchecked")
    page.locator(".connection-saved", has_text="供应商已停用").wait_for(timeout=15_000)
    disabled_catalog = request_json(f"{base_url}/api/v1/providers")
    disabled_profile = next(
        profile for profile in disabled_catalog["profiles"]
        if profile["serviceType"] == "image"
    )
    expect_equal(disabled_profile["enabled"], False, "disabled image provider state")
    expect_equal(disabled_catalog["defaults"]["image"], None, "disabled image default cleared")
    page.locator(".settings-enable-control .switch").click()
    expect_equal(enable_switch.is_checked(), True, "provider switch checked")
    page.locator(".connection-saved", has_text="供应商已启用").wait_for(timeout=15_000)
    page.locator(".settings-detail-default select").select_option(label="fake-image")
    page.wait_for_function(
        "async () => (await (await fetch('/api/v1/providers')).json()).defaults.image !== null"
    )

    catalog = request_json(f"{base_url}/api/v1/providers")
    profiles = [
        profile for profile in catalog["profiles"]
        if profile["name"] in ("E2E LLM", "E2E Image")
    ]
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
        1,
        "starter model provider list",
    )
    page.get_by_role("button", name="添加供应商", exact=True).click()
    model_provider_text = (
        page.locator(".settings-provider-table").inner_text()
        + page.locator(".provider-picker-list").inner_text()
    )
    for provider_name in ("FrostAPI 3D", "Meshy", "混元", "Tripo", "Stability AI 3D"):
        if provider_name not in model_provider_text:
            raise AssertionError(f"missing model provider preset: {provider_name}")
    page.locator(
        ".provider-picker-item",
        has_text="Tripo",
    ).click()
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
        profile for profile in catalog["profiles"]
        if profile["serviceType"] == "model" and profile["enabled"]
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

    page.get_by_role("button", name="LLM 设置", exact=True).click()
    page.get_by_role("button", name="添加供应商", exact=True).click()
    page.locator(".provider-picker-item", has_text="FrostAPI").click()
    page.get_by_label("供应商名称", exact=True).fill("E2E Clear FrostAPI")
    page.locator(".settings-api-key-field input").fill("e2e-secret")
    page.locator(".settings-model-section").wait_for(timeout=15_000)
    page.wait_for_function(
        """async () => {
          const value = await (await fetch('/api/v1/providers')).json();
          const profile = value.profiles.find(item => item.name === 'E2E Clear FrostAPI');
          return profile && profile.hasApiKey && profile.enabled;
        }""",
        timeout=15_000,
    )
    page.get_by_role("button", name="清除已保存密钥", exact=True).click()
    page.wait_for_function(
        """async () => {
          const value = await (await fetch('/api/v1/providers')).json();
          const profile = value.profiles.find(item => item.name === 'E2E Clear FrostAPI');
          return profile && !profile.hasApiKey && !profile.enabled;
        }""",
        timeout=15_000,
    )
    page.locator(".settings-api-key-field small", has_text="尚未设置").wait_for(
        timeout=15_000
    )
    expect_equal(
        page.locator(".settings-enable-control input[type=checkbox]").is_checked(),
        False,
        "provider disabled after clearing required API key",
    )
    expect_equal(
        page.get_by_role("button", name="连通性测试并更新模型", exact=True).is_disabled(),
        True,
        "connection test disabled after clearing API key",
    )
    expect_equal(
        page.get_by_role("button", name="查询余额", exact=True).is_disabled(),
        True,
        "usage query disabled after clearing API key",
    )
    cleared_catalog = request_json(f"{base_url}/api/v1/providers")
    cleared_profile = next(
        profile for profile in cleared_catalog["profiles"]
        if profile["name"] == "E2E Clear FrostAPI"
    )
    expect_equal(cleared_profile["hasApiKey"], False, "cleared API key state")
    expect_equal(cleared_profile["enabled"], False, "cleared provider disabled state")

    page.get_by_role("button", name="Agent 设置", exact=True).click()
    page.locator(".agent-settings-overview").wait_for()
    expect_equal(
        page.locator(".agent-settings-list > article").count(),
        2,
        "Agent settings category count",
    )
    save_screenshot(page, "settings-agent-overview.png")
    page.locator(".agent-settings-list > article", has_text="Agent 提示词设置").get_by_role(
        "button", name="配置", exact=True
    ).click()
    page.locator(".agent-prompt-settings").wait_for()
    save_screenshot(page, "settings-agent-prompts.png")
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
    page.get_by_role("button", name="返回 Agent 设置", exact=True).click()
    page.locator(".agent-settings-list > article", has_text="其他设置").get_by_role(
        "button", name="配置", exact=True
    ).click()
    page.locator(".agent-runtime-settings").wait_for()
    save_screenshot(page, "settings-agent-runtime.png")
    runtime_input = page.locator(".agent-runtime-form input[type=number]")
    runtime_input.fill("12")
    page.locator(".agent-prompt-save-state", has_text="已自动保存").wait_for(
        timeout=15_000
    )
    runtime_snapshot = request_json(
        f"{base_url}/api/v1/settings/agent-runtime"
    )
    expect_equal(
        runtime_snapshot["settings"]["maxToolCalls"],
        12,
        "saved Agent runtime setting",
    )
    page.get_by_role("button", name="恢复默认", exact=True).click()
    page.locator(".agent-prompt-save-state", has_text="已自动保存").wait_for(
        timeout=15_000
    )
    restored_runtime = request_json(
        f"{base_url}/api/v1/settings/agent-runtime"
    )
    expect_equal(
        restored_runtime["settings"],
        restored_runtime["defaults"],
        "restored Agent runtime defaults",
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
    page.get_by_role("button", name="显示设置", exact=True).click()
    page.get_by_text("深色", exact=True).click()
    page.get_by_role("button", name="LLM 设置", exact=True).click()
    configured_row_color = page.locator(
        ".settings-provider-table > article.configured"
    ).first.evaluate("element => getComputedStyle(element).color")
    if configured_row_color == "rgb(66, 71, 80)":
        raise AssertionError("configured provider text still uses the invalid dark color")
    save_screenshot(page, "settings-provider-dark.png")
    page.close()


def run_android_layout_checks(browser: Any, base_url: str) -> None:
    project = next(
        item
        for item in request_json(f"{base_url}/api/v1/projects")["items"]
        if item["name"] == "默认项目"
    )
    for index in range(16):
        request_json(
            f"{base_url}/api/v1/projects/{project['id']}/conversations",
            method="POST",
            body={"title": f"滚动测试对话 {index + 1:02d}"},
        )
    desktop = browser.new_page(viewport={"width": 1440, "height": 720})
    desktop.goto(base_url, wait_until="domcontentloaded", timeout=15_000)
    desktop.locator(".app-shell").wait_for()
    sidebar_list = desktop.locator(".sidebar-conversation-list")
    sidebar_list.wait_for()
    expect_equal(
        sidebar_list.evaluate("element => element.scrollHeight > element.clientHeight"),
        True,
        "desktop sidebar conversation list scrollable",
    )
    sidebar_list.evaluate("element => { element.scrollTop = element.scrollHeight; }")
    expect_equal(
        sidebar_list.evaluate(
            "element => Math.ceil(element.scrollTop + element.clientHeight) >= element.scrollHeight"
        ),
        True,
        "desktop sidebar conversation list reaches bottom",
    )
    assert_no_horizontal_overflow(desktop, "desktop sidebar conversation list")
    save_screenshot(desktop, "sidebar-conversations-long.png")
    desktop.close()
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
    project_option_font = page.get_by_role("menuitemradio").first.evaluate("element => getComputedStyle(element).fontSize")
    project_create_font = page.get_by_role("button", name="新建项目", exact=True).evaluate("element => getComputedStyle(element).fontSize")
    expect_equal(project_create_font, project_option_font, "mobile project menu font size")
    assert_no_horizontal_overflow(page, "mobile project switcher")
    page.locator(".project-switcher-trigger").click()
    assert_no_horizontal_overflow(page, "mobile generation")
    save_screenshot(page, "android-generation.png")
    page.get_by_role("button", name="对话", exact=True).click()
    page.locator(".conversation-page").wait_for()
    page.locator(".conversation-manager").wait_for()
    expect_equal(page.locator(".conversation-page .asset-rail").count(), 0, "mobile conversation asset rail removed")
    page.get_by_role("button", name="选择生图供应商和模型", exact=True).click()
    expect_equal(page.get_by_label("生图供应商", exact=True).count(), 1, "mobile image provider select")
    assert_no_horizontal_overflow(page, "mobile image model picker")
    page.get_by_role("button", name="选择建模供应商和模型", exact=True).click()
    expect_equal(page.get_by_label("建模供应商", exact=True).count(), 1, "mobile model provider select")
    assert_no_horizontal_overflow(page, "mobile model picker")
    page.get_by_role("button", name="选择建模供应商和模型", exact=True).click()
    page.locator(".conversation-manager-trigger").click()
    conversation_list = page.locator(".conversation-manager-list")
    conversation_list.wait_for()
    conversation_list.locator(".conversation-manager-more").first.click()
    action_menu = page.get_by_role("menu", name="对话操作")
    action_menu.get_by_role("menuitem", name="重命名", exact=True).wait_for()
    action_menu.get_by_role("menuitem", name="删除", exact=True).wait_for()
    page.keyboard.press("Escape")
    expect_equal(
        conversation_list.evaluate("element => element.scrollHeight > element.clientHeight"),
        True,
        "mobile conversation list scrollable",
    )
    conversation_list.evaluate("element => { element.scrollTop = element.scrollHeight; }")
    expect_equal(
        conversation_list.evaluate(
            "element => Math.ceil(element.scrollTop + element.clientHeight) >= element.scrollHeight"
        ),
        True,
        "mobile conversation list reaches bottom",
    )
    page.locator(".conversation-manager-trigger").click()
    create_box = page.locator(".conversation-manager-create").bounding_box()
    task_box = page.locator(".conversation-task-button").bounding_box()
    if not create_box or not task_box or abs(create_box["width"] - task_box["width"]) > 1 or abs(create_box["height"] - task_box["height"]) > 1:
        raise AssertionError("mobile new conversation and task buttons must have the same size")
    expect_equal(page.locator(".composer").get_by_role("button", name="素材库", exact=True).count(), 1, "mobile material picker")
    page.locator(".conversation-task-button").click()
    page.locator(".conversation-task-dialog").wait_for()
    assert_no_horizontal_overflow(page, "mobile conversation task dialog")
    save_screenshot(page, "android-conversation-tasks.png")
    page.get_by_role("button", name="关闭任务列表", exact=True).click()
    assert_no_horizontal_overflow(page, "mobile Agent conversation list")
    save_screenshot(page, "android-agent.png")
    page.get_by_role("button", name="图片生成", exact=True).click()
    page.locator(".image-generation-panel").wait_for()
    expect_equal(
        page.locator(".image-generation-layout > .asset-rail").is_hidden(),
        True,
        "mobile project image rail hidden",
    )
    page.locator(".mobile-generation-jobs-button").click()
    page.locator(".generation-flow-card").last.wait_for()
    page.locator(".generation-flow-card").last.scroll_into_view_if_needed()
    page.wait_for_timeout(250)
    expect_equal(
        page.locator(".generation-flow-card.mobile-expanded").count(),
        1,
        "mobile image task single expanded card",
    )
    save_screenshot(page, "android-image-generation-tasks.png")
    page.locator(".generation-flow-card.mobile-expanded .flow-edit-button").click()
    page.get_by_text("编辑并重新生成", exact=True).wait_for()
    page.wait_for_function(
        "() => { const panel = document.querySelector('.image-generation-panel'); return panel && panel.getBoundingClientRect().top < 180; }"
    )
    page.locator(".image-generation-command-bar").scroll_into_view_if_needed()
    assert_no_horizontal_overflow(page, "mobile image generation")
    save_screenshot(page, "android-image-generation.png")
    page.get_by_role("button", name="AI 建模", exact=True).click()
    page.locator(".modeling-page").wait_for()
    model_list_panel = page.locator(".modeling-model-list-panel")
    expect_equal(
        "list-expanded" in (model_list_panel.get_attribute("class") or ""),
        True,
        "mobile model task list starts expanded",
    )
    page.get_by_role("button", name="收起 AI 模型", exact=True).click()
    expect_equal(
        "list-collapsed" in (model_list_panel.get_attribute("class") or ""),
        True,
        "mobile model task list collapses",
    )
    page.get_by_role("button", name="展开 AI 模型", exact=True).click()
    statistics = page.locator(".model-viewer-statistics-card")
    if statistics.count() > 0:
        expect_equal(
            "collapsed" in (statistics.get_attribute("class") or ""),
            True,
            "mobile model information starts collapsed",
        )
    assert_no_horizontal_overflow(page, "mobile modeling")
    save_screenshot(page, "android-modeling.png")
    page.get_by_role("button", name="其他功能", exact=True).click()
    page.get_by_role("button", name="动作参考", exact=True).click()
    page.locator(".pose-studio-page").wait_for()
    page.locator(".pose-editor-canvas").wait_for()
    page.locator(".pose-model-state").wait_for(state="hidden", timeout=20_000)
    expect_equal(page.locator(".pose-template-panel.open").count(), 0, "mobile pose templates collapsed")
    expect_equal(page.locator(".pose-control-panel.open").count(), 0, "mobile pose controls collapsed")
    assert_no_horizontal_overflow(page, "mobile pose studio")
    save_screenshot(page, "android-pose-studio.png")
    page.get_by_role("button", name="素材库", exact=True).click()
    page.locator(".library-page").wait_for()
    page.locator(".asset-source-tabs button").nth(1).click()
    asset_card = page.locator(".asset-library-grid article").first
    asset_card.wait_for()
    card_box = asset_card.bounding_box()
    attach_box = asset_card.get_by_role("button", name="引用并生成", exact=True).bounding_box()
    if not card_box or not attach_box or attach_box["x"] < card_box["x"] or attach_box["x"] + attach_box["width"] > card_box["x"] + card_box["width"] + 1:
        raise AssertionError("mobile asset attach button must stay inside its card")
    assert_no_horizontal_overflow(page, "mobile asset library")
    save_screenshot(page, "android-asset-library.png")
    page.get_by_role("button", name="设置", exact=True).click()
    page.locator(".settings-window").wait_for()
    assert_no_horizontal_overflow(page, "mobile settings list")
    page.get_by_role("button", name="Agent 设置", exact=True).click()
    page.locator(".agent-settings-overview").wait_for()
    assert_no_horizontal_overflow(page, "mobile Agent settings overview")
    save_screenshot(page, "android-agent-settings-overview.png")
    page.locator(".agent-settings-list > article", has_text="Agent 提示词设置").get_by_role(
        "button", name="配置", exact=True
    ).click()
    page.locator(".agent-prompt-settings").wait_for()
    assert_no_horizontal_overflow(page, "mobile Agent prompt settings")
    page.get_by_role("button", name="AI 生图设置", exact=True).click()
    compatible_row = page.locator(
        ".settings-provider-name strong",
        has_text="E2E Image",
    ).locator("xpath=ancestor::article")
    row_alignment = compatible_row.evaluate(
        """element => {
          const name = element.querySelector('.settings-provider-name');
          const menu = element.querySelector('.settings-provider-menu-trigger');
          if (!name || !menu) return null;
          return {
            nameTop: name.getBoundingClientRect().top,
            menuTop: menu.getBoundingClientRect().top
          };
        }"""
    )
    if not row_alignment or abs(row_alignment["nameTop"] - row_alignment["menuTop"]) > 12:
        raise AssertionError(f"mobile provider menu is not on the first row: {row_alignment!r}")
    save_screenshot(page, "android-settings-providers.png")
    compatible_row.locator(".settings-provider-menu-trigger").click()
    compatible_row.get_by_role("button", name="修改配置", exact=True).click()
    page.locator(".settings-connection-editor").wait_for()
    assert_no_horizontal_overflow(page, "mobile settings detail")
    save_screenshot(page, "android-settings.png")
    page.get_by_role("button", name="提示词库", exact=True).click()
    page.locator(".prompt-library-page").wait_for()
    assert_no_horizontal_overflow(page, "mobile prompt library")
    mobile_favorite = page.locator(".favorite-button").first
    favorite_before = mobile_favorite.get_attribute("aria-pressed")
    mobile_favorite.tap()
    mobile_favorite.wait_for()
    page.wait_for_function(
        "([selector, before]) => document.querySelector(selector)?.getAttribute('aria-pressed') !== before",
        arg=[".favorite-button", favorite_before],
    )
    page.locator(".page-heading h1").tap()
    favorite_background = mobile_favorite.evaluate("element => getComputedStyle(element).backgroundColor")
    if favorite_background not in ("rgba(0, 0, 0, 0)", "transparent"):
        raise AssertionError(f"mobile favorite hover state is stuck: {favorite_background}")
    save_screenshot(page, "android-prompt-library.png")
    page.close()


def assert_no_horizontal_overflow(page: Any, label: str) -> None:
    metrics = page.evaluate(
        "() => ({ viewport: document.documentElement.clientWidth, "
        "document: document.documentElement.scrollWidth })"
    )
    if metrics["document"] > metrics["viewport"] + 1:
        raise AssertionError(f"{label}: horizontal overflow {metrics!r}")


def assert_min_readable_font(page: Any, label: str, minimum_px: float = 11.0) -> None:
    offenders = page.evaluate(
        """minimum => [...document.querySelectorAll(
          'button, input, select, textarea, label, small, p, span, strong, h1, h2, h3'
        )].filter(element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          if (style.display === 'none' || style.visibility === 'hidden' ||
              rect.width === 0 || rect.height === 0) return false;
          const text = element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement ||
              element instanceof HTMLSelectElement
            ? `${element.value} ${element.getAttribute('placeholder') || ''}`
            : element.textContent || element.getAttribute('aria-label') || '';
          return text.trim().length > 0 && parseFloat(style.fontSize) < minimum;
        }).slice(0, 12).map(element => ({
          tag: element.tagName.toLowerCase(),
          className: element.className,
          text: (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 50),
          fontSize: getComputedStyle(element).fontSize
        }))""",
        minimum_px,
    )
    if offenders:
        raise AssertionError(f"{label}: text smaller than {minimum_px}px: {offenders!r}")


def verify_persisted_results(base_url: str) -> None:
    project = next(
        item
        for item in request_json(f"{base_url}/api/v1/projects")["items"]
        if item["name"] == "默认项目"
    )
    jobs = request_json(f"{base_url}/api/v1/jobs?projectId={project['id']}&limit=20")["items"]
    succeeded = [job for job in jobs if job["status"] == "succeeded"]
    expect_equal(len(succeeded), 4, "succeeded job count")
    expect_equal({job["source"] for job in succeeded}, {"agent", "manual"}, "job sources")
    agent_jobs = sorted(
        [job for job in succeeded if job["source"] == "agent"],
        key=lambda item: item["createdAt"],
    )
    expect_equal(agent_jobs[0]["prompt"], "生成端到端测试图片", "Agent image prompt")
    expect_equal(
        agent_jobs[1]["inputs"][0]["assetId"],
        agent_jobs[0]["outputs"][0]["assetId"],
        "local task provenance",
    )
    assets = request_json(f"{base_url}/api/v1/projects/{project['id']}/assets?limit=20")["items"]
    generated = [asset for asset in assets if asset["source"] == "generated"]
    expect_equal(len(generated), 4, "generated assets")


def verify_project_directories(data_directory: Path) -> None:
    project_roots = [path for path in (data_directory / "projects").iterdir() if path.is_dir()]
    expect_equal(len(project_roots), 1, "remaining project data directory count")
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
    assert_min_readable_font(page, name)
    configured = os.environ.get("LYRA_E2E_SCREENSHOT_DIR", "").strip()
    if not configured:
        return
    directory = Path(configured)
    directory.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(directory / name), full_page=True)


if __name__ == "__main__":
    raise SystemExit(main())
