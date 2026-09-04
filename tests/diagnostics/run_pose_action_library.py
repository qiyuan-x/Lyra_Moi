from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "e2e"))

from run_browser_flow import find_browser, find_free_port, find_node, stop_process, wait_for_http  # noqa: E402


UAL2_LABELS = [
    "抱臂待机",
    "浇水",
    "忍者跳起步",
    "剑术完整连击",
    "僵尸前行",
]

CORE_LABELS = [
    "A/T 基础姿势",
    "自然站立",
    "慢跑",
]


def main() -> int:
    output = ROOT / "tests" / "diagnostics" / "artifacts" / "extended-action-library"
    output.mkdir(parents=True, exist_ok=True)
    for artifact in output.iterdir():
        if artifact.is_dir():
            shutil.rmtree(artifact)
        elif artifact.suffix.lower() in {".png", ".jpg", ".jpeg"}:
            artifact.unlink()
    port = find_free_port()
    base_url = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="lyra-action-library-") as temporary:
        temporary_root = Path(temporary)
        stop_file = temporary_root / "api.stop"
        environment = {
            **os.environ,
            "LYRA_DEPLOYMENT_MODE": "desktop",
            "LYRA_DATA_DIR": str(temporary_root / "data"),
            "LYRA_HOST": "127.0.0.1",
            "LYRA_PORT": str(port),
            "LYRA_WEB_DIST": str(ROOT / "apps" / "web" / "dist"),
            "LYRA_STOP_FILE": str(stop_file),
        }
        api = subprocess.Popen(
            [str(find_node()), str(ROOT / "apps" / "api" / "dist" / "run.js")],
            cwd=ROOT,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        try:
            wait_for_http(f"{base_url}/api/v1/health/live")
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    headless=True,
                    executable_path=str(find_browser()),
                )
                try:
                    page = browser.new_page(viewport={"width": 1600, "height": 960})
                    page.goto(base_url, wait_until="domcontentloaded", timeout=15_000)
                    page.locator(".app-shell").wait_for()
                    page.get_by_role("button", name="其他功能", exact=True).click()
                    page.get_by_role("button", name="动作参考", exact=True).click()
                    page.get_by_role("button", name="UE5 动画", exact=True).click()
                    page.get_by_role("button", name="模型与导入", exact=False).click()
                    page.get_by_role("button", name="内置动作库", exact=True).click()
                    page.locator(".animation-selected-clip").wait_for(timeout=120_000)
                    page.wait_for_timeout(500)
                    if page.locator(".animation-workspace-error").count() != 0:
                        raise AssertionError(page.locator(".animation-workspace-error").inner_text())
                    clip_count = int(page.locator(".animation-clip-section > header span").inner_text())
                    if clip_count != 87:
                        raise AssertionError(f"expected 87 built-in clips, got {clip_count}")

                    for index, label in enumerate(UAL2_LABELS + CORE_LABELS, start=1):
                        page.get_by_role("button", name="选择动作", exact=True).click()
                        dialog = page.locator(".animation-clip-picker-dialog")
                        dialog.wait_for()
                        dialog.get_by_placeholder("搜索动作").fill(label)
                        dialog.get_by_role("button", name=label, exact=False).click()
                        timeline = page.locator(".animation-timeline input[type=range]")
                        maximum = float(timeline.get_attribute("max") or "0")
                        timeline.evaluate(
                            """(element, value) => {
                              element.value = String(value);
                              element.dispatchEvent(new Event('input', { bubbles: true }));
                              element.dispatchEvent(new Event('change', { bubbles: true }));
                            }""",
                            maximum * 0.5,
                        )
                        page.get_by_role("button", name="复位镜头", exact=True).click()
                        page.wait_for_timeout(180)
                        safe_label = label.replace("/", "_").replace("\\", "_")
                        page.screenshot(path=str(output / f"{index:02d}-{safe_label}.png"), full_page=True)
                        if label == "忍者跳起步":
                            page.get_by_role("button", name="选择动作", exact=True).click()
                            reopened = page.locator(".animation-clip-picker-dialog")
                            active_clip = reopened.locator(
                                ".animation-clip-picker-content button[aria-current='true']"
                            )
                            active_clip.wait_for()
                            position = active_clip.evaluate(
                                """element => {
                                  const content = element.closest('.animation-clip-picker-content');
                                  const item = element.getBoundingClientRect();
                                  const viewport = content.getBoundingClientRect();
                                  return {
                                    delta: Math.abs(
                                      (item.top + item.height / 2)
                                      - (viewport.top + viewport.height / 2)
                                    ),
                                    border: getComputedStyle(element).borderColor
                                  };
                                }"""
                            )
                            if position["delta"] > 12:
                                raise AssertionError(
                                    f"selected clip was not centered: {position['delta']}px"
                                )
                            if position["border"] != "rgb(82, 116, 223)":
                                raise AssertionError(
                                    f"selected clip border was not highlighted: {position['border']}"
                                )
                            reopened.get_by_role("button", name="关闭动作选择", exact=True).click()
                        if index == 1:
                            page.locator(".animation-model-viewport canvas").first.click(position={"x": 20, "y": 20})
                            page.keyboard.press("Space")
                            page.get_by_role("button", name="暂停", exact=True).wait_for()
                            page.wait_for_timeout(800)
                            page.keyboard.press("Space")
                            page.get_by_role("button", name="播放", exact=True).wait_for()

                    mannequin_select = page.locator("label.pose-field", has_text="小白人").locator("select")
                    mannequin_select.select_option("quinn")
                    page.get_by_role("button", name="内置动作库", exact=True).click()
                    page.locator(".animation-model-summary dd[title='UE5 Quinn 扩展动作库']").wait_for(
                        timeout=120_000
                    )
                    if page.locator(".animation-workspace-error").count() != 0:
                        raise AssertionError(page.locator(".animation-workspace-error").inner_text())
                    quinn_clip_count = int(page.locator(".animation-clip-section > header span").inner_text())
                    if quinn_clip_count != 87:
                        raise AssertionError(f"expected 87 Quinn clips, got {quinn_clip_count}")
                finally:
                    browser.close()
        finally:
            stop_file.touch(exist_ok=True)
            stop_process(api)

    print(
        "Extended action library loaded 87 clips for Manny and Quinn; "
        "previewed UAL2 and core poses; selection centering and Space playback passed."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
