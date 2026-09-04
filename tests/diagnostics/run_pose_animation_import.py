from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "e2e"))

from run_browser_flow import find_browser, find_free_port, find_node, stop_process, wait_for_http  # noqa: E402


def main() -> int:
    fixture = ROOT / "tests" / "diagnostics" / "artifacts" / "ue5-manny" / "manny-import-test.fbx"
    if not fixture.is_file():
        raise SystemExit(f"missing FBX fixture: {fixture}")

    port = find_free_port()
    base_url = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="lyra-pose-import-") as temporary:
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
                    page.locator(".animation-model-layout").wait_for()

                    import_toggle = page.get_by_role("button", name="模型与导入", exact=False)
                    if import_toggle.get_attribute("aria-expanded") != "false":
                        raise AssertionError("UE5 模型与导入区域应默认折叠")
                    if page.locator(".animation-clip-section").bounding_box() is None:
                        raise AssertionError("动画片段区域没有完整显示")

                    import_toggle.click()
                    page.locator(".animation-import-section input[type=file]").set_input_files(str(fixture))
                    page.locator(".animation-selected-clip").wait_for(timeout=30_000)
                    if page.locator(".animation-workspace-error").count() != 0:
                        raise AssertionError(page.locator(".animation-workspace-error").inner_text())
                    if import_toggle.get_attribute("aria-expanded") != "true":
                        raise AssertionError("导入完成后模型与导入区域被自动折叠")
                    page.get_by_role("button", name="复位镜头", exact=True).click()
                    page.wait_for_timeout(180)
                    imported_screenshot = ROOT / "tests" / "diagnostics" / "artifacts" / "ue5-manny" / "pose-animation-imported.png"
                    page.screenshot(path=str(imported_screenshot), full_page=True)

                    page.locator(".animation-timeline input[type=range]").fill("0.5")
                    page.get_by_role("button", name="发送当前帧到动作编辑", exact=True).click()
                    page.locator(".pose-studio-layout").wait_for()
                    time.sleep(0.4)
                    pose = page.evaluate(
                        """() => {
                          const key = Object.keys(localStorage).find((item) => item.startsWith('lyra.poseStudio.project.v2.'));
                          return key ? JSON.parse(localStorage.getItem(key)) : null;
                        }"""
                    )
                    if not pose:
                        raise AssertionError("发送后的动作没有保存到动作编辑")
                    upper_arm = pose["bones"]["leftUpperArm"]["rotation"]
                    if max(abs(float(value)) for value in upper_arm) < 10:
                        raise AssertionError(f"当前帧仍按错误的绑定姿势发送：{upper_arm}")
                    pelvis = pose["bones"]["pelvis"]
                    pelvis_offset = [*pelvis["position"], *pelvis["rotation"]]
                    if max(abs(float(value)) for value in pelvis_offset) > 0.5:
                        raise AssertionError(f"FBX 全局坐标轴没有自动归一化：{pelvis}")
                    print(
                        "transferred pose:",
                        {
                            "pelvis": pose["bones"]["pelvis"],
                            "leftUpperArm": pose["bones"]["leftUpperArm"],
                            "leftThigh": pose["bones"]["leftThigh"],
                        },
                    )

                    screenshot = ROOT / "tests" / "diagnostics" / "artifacts" / "ue5-manny" / "pose-import-result.png"
                    page.screenshot(path=str(screenshot), full_page=True)
                finally:
                    browser.close()
        finally:
            stop_file.touch(exist_ok=True)
            stop_process(api)

    print("UE5 Manny FBX import, automatic mapping, expanded import panel and frame transfer passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
