from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from apps.launcher.paths import LauncherPaths
from apps.launcher.update_manager import (
    DesktopUpdateClient,
    DesktopUpdateInstaller,
    _write_json_atomic,
)


class FakeProcessManager:
    def __init__(self, root: Path, fail_first_start: bool = False) -> None:
        self.root = root
        self.fail_first_start = fail_first_start
        self.stop_count = 0
        self.start_count = 0

    def stop_services(self) -> dict[str, object]:
        self.stop_count += 1
        return {}

    def start_services(self) -> dict[str, object]:
        self.start_count += 1
        if self.fail_first_start and self.start_count == 1:
            database = self.root / "data" / "database" / "lyra.sqlite3"
            database.write_text("migrated", encoding="utf-8")
            raise RuntimeError("new version failed")
        return {}

    def is_api_ready(self, timeout: float = 1.0) -> bool:
        return True


class DesktopUpdateInstallerTests(unittest.TestCase):
    def test_launcher_checks_manifest_and_schedules_detached_updater(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyra-update-client-") as temporary:
            root = Path(temporary)
            paths = self._prepare_release(root)
            (root / "LyraLauncher.exe").write_bytes(b"launcher")
            (root / "release.json").write_text(json.dumps({
                "schemaVersion": 1,
                "version": "0.0.2",
                "updateManifestUrl": "https://updates.example/latest.json",
            }), encoding="utf-8")
            manifest = {
                "schemaVersion": 1,
                "version": "0.0.3",
                "publishedAt": "2026-08-22T00:00:00Z",
                "releaseNotes": ["launcher update"],
                "artifacts": {
                    "windows-x64": {
                        "url": "https://updates.example/Lyra-update.zip",
                        "sha256": "a" * 64,
                        "size": 1024,
                    }
                },
            }
            client = DesktopUpdateClient(paths)
            with patch(
                "apps.launcher.update_manager.urllib.request.urlopen",
                return_value=io.BytesIO(json.dumps(manifest).encode("utf-8")),
            ):
                result = client.check()

            self.assertTrue(result.update_available)
            self.assertEqual(result.latest_version, "0.0.3")
            self.assertEqual(result.release_notes, ("launcher update",))
            with patch("apps.launcher.update_manager.subprocess.Popen") as spawn:
                client.start_update(result.candidate, 3000)  # type: ignore[arg-type]
            request = json.loads(paths.update_request_file.read_text(encoding="utf-8"))
            self.assertTrue(request["updateLauncher"])
            self.assertTrue(request["restartLauncher"])
            self.assertEqual(request["targetVersion"], "0.0.3")
            self.assertTrue((root / "data" / "temp" / "updater" / "LyraUpdater.exe").is_file())
            spawn.assert_called_once()

    def test_updates_launcher_executable_from_staged_helper(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyra-updater-launcher-") as temporary:
            root = Path(temporary)
            paths = self._prepare_release(root)
            (root / "LyraLauncher.exe").write_text("old-launcher", encoding="utf-8")
            archive = self._create_archive(root, "0.0.3")
            manager = FakeProcessManager(root)
            request = self._create_request(
                root,
                archive,
                "0.0.3",
                update_launcher=True,
            )

            DesktopUpdateInstaller(paths, lambda _paths, _port: manager).apply(request)

            self.assertEqual(
                (root / "LyraLauncher.exe").read_text(encoding="utf-8"),
                "new-launcher",
            )

    def test_retries_atomic_state_replacement_when_windows_temporarily_locks_file(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyra-updater-state-") as temporary:
            state_file = Path(temporary) / "state.json"
            state_file.write_text("{}", encoding="utf-8")
            real_replace = os.replace
            attempts = 0

            def flaky_replace(source: Path, destination: Path) -> None:
                nonlocal attempts
                attempts += 1
                if attempts == 1:
                    raise PermissionError(13, "temporarily locked", str(destination))
                real_replace(source, destination)

            with patch("apps.launcher.update_manager.os.replace", side_effect=flaky_replace), patch(
                "apps.launcher.update_manager.time.sleep"
            ):
                _write_json_atomic(state_file, {"status": "completed"})

            self.assertEqual(json.loads(state_file.read_text()), {"status": "completed"})
            self.assertEqual(attempts, 2)

    def test_applies_a_verified_update_without_touching_user_data(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyra-updater-success-") as temporary:
            root = Path(temporary)
            paths = self._prepare_release(root)
            archive = self._create_archive(root, "0.0.3")
            manager = FakeProcessManager(root)
            request = self._create_request(root, archive, "0.0.3")

            DesktopUpdateInstaller(paths, lambda _paths, _port: manager).apply(request)

            self.assertEqual((root / "app" / "api" / "run.js").read_text(), "new-api")
            self.assertEqual((root / "data" / "database" / "lyra.sqlite3").read_text(), "user-data")
            self.assertEqual(
                json.loads((root / "app" / "release.json").read_text())["version"],
                "0.0.3",
            )
            self.assertFalse((root / "release.json").exists())
            self.assertEqual(manager.stop_count, 1)
            self.assertEqual(manager.start_count, 1)
            state = json.loads((root / "data" / "run" / "application-update-state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["snapshot"]["status"], "completed")
            self.assertEqual(state["snapshot"]["currentVersion"], "0.0.3")
            self.assertFalse(request.exists())

    def test_accepts_a_legacy_archive_with_only_a_root_manifest(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyra-updater-legacy-archive-") as temporary:
            root = Path(temporary)
            paths = self._prepare_release(root)
            archive = self._create_archive(root, "0.0.3", include_app_manifest=False)
            manager = FakeProcessManager(root)
            request = self._create_request(root, archive, "0.0.3")

            DesktopUpdateInstaller(paths, lambda _paths, _port: manager).apply(request)

            self.assertEqual(paths.application_version, "0.0.3")
            self.assertTrue(paths.release_manifest.is_file())
            self.assertFalse(paths.legacy_release_manifest.exists())

    def test_rejects_a_bad_checksum_before_stopping_services(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyra-updater-checksum-") as temporary:
            root = Path(temporary)
            paths = self._prepare_release(root)
            archive = self._create_archive(root, "0.0.3")
            manager = FakeProcessManager(root)
            request = self._create_request(root, archive, "0.0.3", sha256="0" * 64)

            with self.assertRaisesRegex(RuntimeError, "SHA-256"):
                DesktopUpdateInstaller(paths, lambda _paths, _port: manager).apply(request)

            self.assertEqual((root / "app" / "api" / "run.js").read_text(), "old-api")
            self.assertEqual(manager.stop_count, 0)
            state = json.loads((root / "data" / "run" / "application-update-state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["snapshot"]["status"], "failed")

    def test_rolls_back_application_and_database_when_restart_fails(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyra-updater-rollback-") as temporary:
            root = Path(temporary)
            paths = self._prepare_release(root)
            archive = self._create_archive(root, "0.0.3")
            manager = FakeProcessManager(root, fail_first_start=True)
            request = self._create_request(root, archive, "0.0.3")

            with self.assertRaisesRegex(RuntimeError, "new version failed"):
                DesktopUpdateInstaller(paths, lambda _paths, _port: manager).apply(request)

            self.assertEqual((root / "app" / "api" / "run.js").read_text(), "old-api")
            self.assertEqual((root / "data" / "database" / "lyra.sqlite3").read_text(), "user-data")
            self.assertEqual(
                json.loads((root / "app" / "release.json").read_text())["version"],
                "0.0.2",
            )
            self.assertFalse((root / "release.json").exists())
            self.assertEqual(manager.start_count, 2)
            state = json.loads((root / "data" / "run" / "application-update-state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["snapshot"]["status"], "failed")
            self.assertEqual(state["snapshot"]["currentVersion"], "0.0.2")

    def test_rejects_zip_path_traversal(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyra-updater-path-") as temporary:
            root = Path(temporary)
            paths = self._prepare_release(root)
            archive = root / "bad.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("../outside.txt", "bad")
            manager = FakeProcessManager(root)
            request = self._create_request(root, archive, "0.0.3")

            with self.assertRaisesRegex(RuntimeError, "不安全路径"):
                DesktopUpdateInstaller(paths, lambda _paths, _port: manager).apply(request)

            self.assertFalse((root.parent / "outside.txt").exists())
            self.assertEqual(manager.stop_count, 0)

    def test_moves_the_legacy_root_manifest_into_the_app_directory(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyra-release-manifest-") as temporary:
            root = Path(temporary)
            paths = self._prepare_release(root)

            paths.migrate_legacy_release_manifest()

            self.assertEqual(paths.application_version, "0.0.2")
            self.assertTrue((root / "app" / "release.json").is_file())
            self.assertFalse((root / "release.json").exists())

    @staticmethod
    def _prepare_release(root: Path) -> LauncherPaths:
        (root / "app" / "api").mkdir(parents=True)
        (root / "app" / "worker" / "resources").mkdir(parents=True)
        (root / "app" / "web").mkdir(parents=True)
        (root / "app" / "api" / "run.js").write_text("old-api", encoding="utf-8")
        (root / "app" / "worker" / "run.js").write_text("old-worker", encoding="utf-8")
        (root / "app" / "worker" / "resources" / "agent-system-v1.txt").write_text("old-prompt", encoding="utf-8")
        (root / "app" / "web" / "index.html").write_text("old-web", encoding="utf-8")
        (root / "release.json").write_text(json.dumps({"schemaVersion": 1, "version": "0.0.2"}), encoding="utf-8")
        (root / "data" / "database").mkdir(parents=True)
        (root / "data" / "database" / "lyra.sqlite3").write_text("user-data", encoding="utf-8")
        (root / "data" / "run").mkdir(parents=True)
        return LauncherPaths(
            base_dir=root,
            data_dir=root / "data",
            node_executable=Path(sys.executable),
            api_entry=root / "app" / "api" / "run.js",
            worker_entry=root / "app" / "worker" / "run.js",
            web_root=root / "app" / "web",
            system_prompt=root / "app" / "worker" / "resources" / "agent-system-v1.txt",
        )

    @staticmethod
    def _create_archive(
        root: Path,
        version: str,
        *,
        include_app_manifest: bool = True,
    ) -> Path:
        archive = root / f"update-{version}.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            manifest = json.dumps({"schemaVersion": 1, "version": version})
            bundle.writestr("release.json", manifest)
            if include_app_manifest:
                bundle.writestr("app/release.json", manifest)
            bundle.writestr("app/api/run.js", "new-api")
            bundle.writestr("app/worker/run.js", "new-worker")
            bundle.writestr("app/worker/resources/agent-system-v1.txt", "new-prompt")
            bundle.writestr("app/web/index.html", "new-web")
            bundle.writestr("LyraLauncher.exe", "new-launcher")
        return archive

    @staticmethod
    def _create_request(
        root: Path,
        archive: Path,
        target_version: str,
        *,
        sha256: str | None = None,
        update_launcher: bool = False,
    ) -> Path:
        state_file = root / "data" / "run" / "application-update-state.json"
        state_file.write_text(json.dumps({
            "schemaVersion": 1,
            "snapshot": {
                "enabled": True,
                "currentVersion": "0.0.2",
                "latestVersion": target_version,
                "platform": "windows-x64",
                "updateAvailable": True,
                "status": "scheduled",
                "progress": 0,
                "message": "scheduled",
                "checkedAt": "2026-08-21T00:00:00Z",
                "publishedAt": "2026-08-21T00:00:00Z",
                "releaseNotes": [],
                "artifactSize": archive.stat().st_size,
            },
        }), encoding="utf-8")
        request = root / "data" / "run" / "application-update-request.json"
        request.write_text(json.dumps({
            "schemaVersion": 1,
            "baseDir": str(root),
            "currentVersion": "0.0.2",
            "targetVersion": target_version,
            "platform": "windows-x64",
            "artifact": {
                "url": archive.as_uri(),
                "sha256": sha256 or hashlib.sha256(archive.read_bytes()).hexdigest(),
                "size": archive.stat().st_size,
            },
            "stateFile": str(state_file),
            "port": 3000,
            "updateLauncher": update_launcher,
        }), encoding="utf-8")
        return request


if __name__ == "__main__":
    unittest.main()
