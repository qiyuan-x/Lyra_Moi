from __future__ import annotations

import os
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
        return cls(
            base_dir=root,
            data_dir=root / "data",
            node_executable=node_executable,
            api_entry=api_entry,
            worker_entry=worker_entry,
            web_root=web_root,
            system_prompt=system_prompt,
        )

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
