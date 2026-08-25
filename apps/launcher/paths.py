from __future__ import annotations

import os
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class LauncherPaths:
    base_dir: Path
    data_dir: Path
    node_executable: Path
    api_entry: Path
    worker_entry: Path
    web_root: Path
    system_prompt: Path

    @property
    def release_manifest(self) -> Path:
        return self.base_dir / "app" / "release.json"

    @property
    def legacy_release_manifest(self) -> Path:
        return self.base_dir / "release.json"

    @property
    def application_version(self) -> str:
        for manifest in (
            self.release_manifest,
            self.legacy_release_manifest,
            self.base_dir / "package.json",
        ):
            try:
                value = json.loads(manifest.read_text(encoding="utf-8"))
                version = value.get("version") if isinstance(value, dict) else None
                if isinstance(version, str) and version.strip():
                    return version.strip()
            except (OSError, ValueError):
                pass
        return "0.0.6"

    @property
    def update_manifest_url(self) -> str | None:
        configured = os.environ.get("LYRA_UPDATE_MANIFEST_URL", "").strip()
        if configured:
            return configured
        for manifest in (self.release_manifest, self.legacy_release_manifest):
            try:
                value = json.loads(manifest.read_text(encoding="utf-8"))
                url = value.get("updateManifestUrl") if isinstance(value, dict) else None
                if isinstance(url, str) and url.strip():
                    return url.strip()
            except (OSError, ValueError):
                pass
        return None

    def migrate_legacy_release_manifest(self) -> None:
        legacy = self.legacy_release_manifest
        target = self.release_manifest
        if not legacy.is_file() or not (self.base_dir / "app").is_dir():
            return
        try:
            if not target.is_file():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(legacy, target)
            legacy.unlink(missing_ok=True)
        except OSError:
            pass

    @property
    def update_helper_command(self) -> list[str]:
        packaged_launcher = self.base_dir / "LyraLauncher.exe"
        if getattr(sys, "frozen", False) or packaged_launcher.is_file():
            executable = Path(sys.executable).resolve() if getattr(sys, "frozen", False) else packaged_launcher
            return [str(executable), "--apply-update"]
        return [
            str(Path(sys.executable).resolve()),
            str(self.base_dir / "main.py"),
            "--base-dir",
            str(self.base_dir),
            "--apply-update",
        ]

    @classmethod
    def discover(cls, base_dir: Path | str | None = None) -> "LauncherPaths":
        if base_dir is not None:
            root = Path(base_dir).expanduser().resolve()
        elif getattr(sys, "frozen", False):
            root = Path(sys.executable).resolve().parent
        else:
            root = Path(__file__).resolve().parents[2]

        release_api = root / "app" / "api" / "run.js"
        release_worker = root / "app" / "worker" / "run.js"
        if release_api.is_file() or release_worker.is_file():
            api_entry = release_api
            worker_entry = release_worker
            web_root = root / "app" / "web"
            system_prompt = root / "app" / "worker" / "resources" / "agent-system-v1.txt"
        else:
            api_entry = root / "apps" / "api" / "dist" / "run.js"
            worker_entry = root / "apps" / "worker" / "dist" / "run.js"
            web_root = root / "apps" / "web" / "dist"
            system_prompt = root / "resources" / "prompts" / "agent-system-v1.txt"

        node_executable = _resolve_node(root)
        paths = cls(
            base_dir=root,
            data_dir=root / "data",
            node_executable=node_executable,
            api_entry=api_entry,
            worker_entry=worker_entry,
            web_root=web_root,
            system_prompt=system_prompt,
        )
        paths.migrate_legacy_release_manifest()
        return paths

    @property
    def run_dir(self) -> Path:
        return self.data_dir / "run"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def session_file(self) -> Path:
        return self.run_dir / "launcher-session.json"

    @property
    def lock_file(self) -> Path:
        return self.run_dir / "launcher.lock"

    @property
    def update_state_file(self) -> Path:
        return self.run_dir / "application-update-state.json"

    @property
    def update_request_file(self) -> Path:
        return self.run_dir / "application-update-request.json"

    def stop_file(self, role: str) -> Path:
        return self.run_dir / f"{role}.stop"

    def log_file(self, role: str) -> Path:
        return self.logs_dir / f"{role}.log"

    def ensure_runtime_directories(self) -> None:
        for directory in (self.data_dir, self.run_dir, self.logs_dir):
            directory.mkdir(parents=True, exist_ok=True)

    def validate_startup_files(self) -> None:
        required = {
            "Node runtime": self.node_executable,
            "API entry": self.api_entry,
            "Worker entry": self.worker_entry,
            "Web build": self.web_root / "index.html",
            "Agent prompt": self.system_prompt,
        }
        missing = [f"{label}: {path}" for label, path in required.items() if not path.is_file()]
        if missing:
            raise FileNotFoundError("Required runtime files are missing:\n" + "\n".join(missing))
        version = _node_major_version(self.node_executable)
        if version is None or version < 22:
            raise RuntimeError(f"Lyra requires Node.js 22 or newer: {self.node_executable}")


def _resolve_node(root: Path) -> Path:
    configured = os.environ.get("LYRA_NODE_EXECUTABLE", "").strip()
    candidates = [
        Path(configured).expanduser() if configured else None,
        root / "runtime" / "node" / "node.exe",
        root / "runtime" / "node" / "node",
        Path.home()
        / ".cache"
        / "codex-runtimes"
        / "codex-primary-runtime"
        / "dependencies"
        / "node"
        / "bin"
        / "node.exe",
    ]
    candidates.extend(
        Path.home().glob(
            ".cache/codex-runtimes/*/dependencies/node/bin/node.exe"
        )
    )
    discovered = shutil.which("node")
    if discovered:
        candidates.append(Path(discovered))
    for candidate in candidates:
        if candidate is not None and candidate.is_file() and (_node_major_version(candidate) or 0) >= 22:
            return candidate.resolve()
    return (root / "runtime" / "node" / ("node.exe" if os.name == "nt" else "node")).resolve()


def _node_major_version(executable: Path) -> int | None:
    try:
        result = subprocess.run(
            [str(executable), "--version"],
            capture_output=True,
            check=True,
            text=True,
            timeout=3,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        value = result.stdout.strip().removeprefix("v").split(".", 1)[0]
        return int(value)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
