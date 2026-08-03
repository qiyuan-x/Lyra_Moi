from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path

from apps.launcher.paths import LauncherPaths
from apps.launcher.process_manager import (
    ProcessManager,
    ProcessRecord,
    force_terminate,
    get_process_creation_token,
    process_matches,
)


class ProcessManagerTests(unittest.TestCase):
    def test_discovers_release_layout(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyra-launcher-paths-") as temporary:
            root = Path(temporary)
            (root / "app" / "api").mkdir(parents=True)
            (root / "app" / "api" / "run.js").write_text("", encoding="utf-8")
            paths = LauncherPaths.discover(root)
            self.assertEqual(paths.base_dir, root.resolve())
            self.assertEqual(paths.api_entry, root / "app" / "api" / "run.js")
            self.assertEqual(paths.data_dir, root / "data")

    def test_matches_pid_and_creation_token(self) -> None:
        token = get_process_creation_token(os.getpid())
        self.assertIsNotNone(token)
        record = ProcessRecord(
            role="api",
            pid=os.getpid(),
            creation_token=token or "",
            session_id=str(uuid.uuid4()),
            started_at="2026-01-01T00:00:00Z",
            command=[sys.executable],
        )
        self.assertTrue(process_matches(record))
        mismatched = ProcessRecord(**{**record.__dict__, "creation_token": f"{token}-wrong"})
        self.assertFalse(process_matches(mismatched))
        force_terminate(mismatched)
        self.assertIsNotNone(get_process_creation_token(os.getpid()))

    def test_gracefully_stops_only_recorded_child(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyra-launcher-stop-") as temporary:
            root = Path(temporary)
            paths = LauncherPaths(
                base_dir=root,
                data_dir=root / "data",
                node_executable=Path(sys.executable),
                api_entry=root / "api.js",
                worker_entry=root / "worker.js",
                web_root=root / "web",
                system_prompt=root / "prompt.txt",
            )
            manager = ProcessManager(paths, startup_timeout=2, stop_timeout=2)
            stop_file = paths.stop_file("worker")
            fixture = Path(__file__).resolve().parents[1] / "fixtures" / "launcher_child.py"
            child = subprocess.Popen(
                [sys.executable, str(fixture), str(stop_file)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                token = self._wait_for_token(child.pid)
                record = ProcessRecord(
                    role="worker",
                    pid=child.pid,
                    creation_token=token,
                    session_id=str(uuid.uuid4()),
                    started_at="2026-01-01T00:00:00Z",
                    command=[sys.executable, str(fixture)],
                )
                manager._stop_records([record])
                child.wait(timeout=2)
                self.assertEqual(child.returncode, 0)
                self.assertFalse(process_matches(record))
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=2)

    @staticmethod
    def _wait_for_token(pid: int) -> str:
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            token = get_process_creation_token(pid)
            if token:
                return token
            time.sleep(0.02)
        raise AssertionError("Child process token was not available.")


if __name__ == "__main__":
    unittest.main()
