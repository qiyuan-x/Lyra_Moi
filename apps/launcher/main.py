from __future__ import annotations

import argparse
import json
import os
import subprocess
import webbrowser
from pathlib import Path

from .app import LYRA_VERSION, LyraLauncher, enable_high_dpi
from .paths import LauncherPaths
from .process_manager import ProcessManager
from .update_manager import DesktopUpdateInstaller


def main() -> int:
    parser = argparse.ArgumentParser(description="Lyra desktop service launcher")
    parser.add_argument("--version", action="version", version=f"Lyra Launcher {LYRA_VERSION}")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--start", action="store_true", help="Start API and workers")
    action.add_argument("--stop", action="store_true", help="Stop owned API and workers")
    action.add_argument("--restart", action="store_true", help="Restart owned API and workers")
    action.add_argument("--status", action="store_true", help="Print service status")
    action.add_argument("--open-browser", action="store_true", help="Open the Lyra web app")
    action.add_argument("--apply-update", type=Path, help="Apply an application update request")
    parser.add_argument("--base-dir", type=Path, help="Override launcher base directory")
    arguments = parser.parse_args()

    paths = LauncherPaths.discover(arguments.base_dir)
    manager = ProcessManager(paths)
    if arguments.apply_update:
        restart_launcher = _should_restart_launcher(arguments.apply_update)
        try:
            DesktopUpdateInstaller(paths).apply(arguments.apply_update)
            return 0
        except Exception:
            return 1
        finally:
            if restart_launcher:
                _start_desktop_launcher(paths)
    if arguments.start:
        print(_status_json(manager.start_services()))
        return 0
    if arguments.stop:
        print(_status_json(manager.stop_services()))
        return 0
    if arguments.restart:
        print(_status_json(manager.restart_services()))
        return 0
    if arguments.status:
        print(_status_json(manager.get_status()))
        return 0
    if arguments.open_browser:
        webbrowser.open(manager.browser_url)
        return 0

    enable_high_dpi()
    application = LyraLauncher(manager)
    application.mainloop()
    return 0


def _status_json(statuses: dict[str, object]) -> str:
    payload = {
        role: {
            "running": getattr(status, "running"),
            "pid": getattr(status, "pid"),
        }
        for role, status in statuses.items()
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _should_restart_launcher(request_file: Path) -> bool:
    try:
        value = json.loads(request_file.read_text(encoding="utf-8"))
        return isinstance(value, dict) and value.get("restartLauncher") is True
    except (OSError, ValueError):
        return False


def _start_desktop_launcher(paths: LauncherPaths) -> None:
    launcher = paths.base_dir / "LyraLauncher.exe"
    if not launcher.is_file():
        return
    options: dict[str, object] = {
        "cwd": str(paths.base_dir),
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if os.name == "nt":
        options["creationflags"] = (
            subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        )
    else:
        options["start_new_session"] = True
    subprocess.Popen([str(launcher)], **options)


if __name__ == "__main__":
    raise SystemExit(main())
