from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "e2e"))

from run_browser_flow import find_browser, find_free_port, find_node, stop_process, wait_for_http  # noqa: E402


def main() -> int:
    files = [Path(value).resolve() for value in sys.argv[1:]]
    if not files or any(not file.is_file() for file in files):
        raise SystemExit("usage: run_ue5_dance_import.py <animation.fbx> [animation.fbx ...]")

    output = ROOT / "tests" / "diagnostics" / "artifacts" / "ue5-dance-import"
    output.mkdir(parents=True, exist_ok=True)
    for screenshot in output.glob("*.png"):
        screenshot.unlink()

    port = find_free_port()
    base_url = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="lyra-ue5-dance-") as temporary:
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

                    import_toggle = page.get_by_role("button", name="模型与导入", exact=False)
                    import_toggle.click()
                    page.locator(".animation-import-section input[type=file]").set_input_files(
                        [str(file) for file in files]
                    )
                    page.locator(".animation-save-state").filter(
                        has_text=f"已加入 {len(files)} 个动作"
                    ).wait_for(timeout=180_000)
                    if import_toggle.get_attribute("aria-expanded") != "true":
                        raise AssertionError("导入完成后模型与导入区域被自动折叠")
                    if page.locator(".animation-workspace-error").count() != 0:
                        raise AssertionError(page.locator(".animation-workspace-error").inner_text())

                    timeline = page.locator(".animation-timeline input[type=range]")
                    maximum = float(timeline.get_attribute("max") or "0")
                    for index, ratio in enumerate((0.0, 0.5, 0.95), start=1):
                        timeline.evaluate(
                            """(element, value) => {
                              element.value = String(value);
                              element.dispatchEvent(new Event('input', { bubbles: true }));
                              element.dispatchEvent(new Event('change', { bubbles: true }));
                            }""",
                            maximum * ratio,
                        )
                        page.get_by_role("button", name="复位镜头", exact=True).click()
                        page.wait_for_timeout(200)
                        page.screenshot(path=str(output / f"{index:02d}-{round(ratio * 100)}.png"), full_page=True)

                    page.get_by_role("button", name="项目动作库", exact=False).click()
                    items = page.locator(".animation-project-item")
                    if items.count() != len(files):
                        raise AssertionError(f"expected {len(files)} imported files, got {items.count()}")

                    page.get_by_role("button", name="其他骨骼动画", exact=True).click()
                    page.locator(".animation-import-section input[type=file]").set_input_files(str(files[-1]))
                    page.locator(".animation-selected-clip").wait_for(timeout=60_000)
                    direct_timeline = page.locator(".animation-timeline input[type=range]")
                    direct_maximum = float(direct_timeline.get_attribute("max") or "0")
                    direct_timeline.evaluate(
                        """(element, value) => {
                          element.value = String(value);
                          element.dispatchEvent(new Event('input', { bubbles: true }));
                          element.dispatchEvent(new Event('change', { bubbles: true }));
                        }""",
                        direct_maximum * 0.95,
                    )
                    page.get_by_role("button", name="复位镜头", exact=True).click()
                    page.wait_for_timeout(200)
                    page.screenshot(path=str(output / "04-direct-95.png"), full_page=True)
                finally:
                    browser.close()
        finally:
            stop_file.touch(exist_ok=True)
            stop_process(api)

    print(f"Imported {len(files)} UE5 animation files; multi-select and expanded import panel passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
