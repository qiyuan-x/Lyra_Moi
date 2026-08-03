from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from apps.launcher.paths import LauncherPaths  # noqa: E402
from apps.launcher.process_manager import ProcessManager  # noqa: E402


def main() -> int:
    for base_dir in (ROOT, ROOT / "release"):
        session_file = base_dir / "data" / "run" / "launcher-session.json"
        if not session_file.exists():
            continue
        manager = ProcessManager(LauncherPaths.discover(base_dir))
        manager.stop_services()
        print(f"Stopped launcher services under {base_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
