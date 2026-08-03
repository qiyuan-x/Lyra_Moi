from __future__ import annotations

import argparse
import json
import webbrowser
from pathlib import Path

from .app import LYRA_VERSION, LyraLauncher, enable_high_dpi
from .paths import LauncherPaths
from .process_manager import ProcessManager


def main() -> int:
    parser = argparse.ArgumentParser(description="Lyra desktop service launcher")
    parser.add_argument("--version", action="version", version=f"Lyra Launcher {LYRA_VERSION}")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--start", action="store_true", help="Start API and workers")
    action.add_argument("--stop", action="store_true", help="Stop owned API and workers")
    action.add_argument("--restart", action="store_true", help="Restart owned API and workers")
    action.add_argument("--status", action="store_true", help="Print service status")
    action.add_argument("--open-browser", action="store_true", help="Open the Lyra web app")
    parser.add_argument("--base-dir", type=Path, help="Override launcher base directory")
    arguments = parser.parse_args()

    paths = LauncherPaths.discover(arguments.base_dir)
    manager = ProcessManager(paths)
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


if __name__ == "__main__":
    raise SystemExit(main())
