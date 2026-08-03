from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = ROOT / "build"
RELEASE_DIR = ROOT / "release"
APP_DIR = RELEASE_DIR / "app"
sys.path.insert(0, str(ROOT))

from apps.launcher.paths import LauncherPaths  # noqa: E402
from apps.launcher.process_manager import ProcessManager  # noqa: E402


def main() -> int:
    _stop_existing_release()
    _safe_remove(BUILD_DIR)
    _safe_remove(RELEASE_DIR)
    (APP_DIR / "api").mkdir(parents=True)
    (APP_DIR / "worker" / "resources").mkdir(parents=True)
    (RELEASE_DIR / "data").mkdir(parents=True)

    _bundle_node_services()
    _copy_web_and_resources()
    _copy_sharp_runtime()
    _copy_node_runtime()
    _build_launcher_executable()
    _smoke_test_release()
    _reset_release_data()
    _safe_remove(BUILD_DIR)

    executable = RELEASE_DIR / "LyraLauncher.exe"
    print(f"Windows release created: {executable}")
    return 0


def _bundle_node_services() -> None:
    esbuild = ROOT / "node_modules" / ".bin" / "esbuild.cmd"
    if not esbuild.is_file():
        raise FileNotFoundError(f"esbuild is missing: {esbuild}")
    for role in ("api", "worker"):
        _run(
            [
                str(esbuild),
                str(ROOT / "apps" / role / "src" / "run.ts"),
                "--bundle",
                "--platform=node",
                "--format=esm",
                "--target=node22",
                f"--outfile={APP_DIR / role / 'run.js'}",
                "--external:sharp",
            ]
        )
    (APP_DIR / "package.json").write_text(
        json.dumps({"private": True, "type": "module"}, indent=2),
        encoding="utf-8",
    )


def _copy_web_and_resources() -> None:
    web_dist = ROOT / "apps" / "web" / "dist"
    if not (web_dist / "index.html").is_file():
        raise FileNotFoundError("Web production build is missing. Run pnpm build first.")
    shutil.copytree(web_dist, APP_DIR / "web")
    shutil.copy2(
        ROOT / "resources" / "prompts" / "agent-system-v1.txt",
        APP_DIR / "worker" / "resources" / "agent-system-v1.txt",
    )


def _copy_sharp_runtime() -> None:
    sharp_source = (ROOT / "packages" / "storage" / "node_modules" / "sharp").resolve()
    dependency_root = sharp_source.parent
    targets = {
        APP_DIR / "node_modules" / "sharp": sharp_source,
        APP_DIR / "node_modules" / "detect-libc": (dependency_root / "detect-libc").resolve(),
        APP_DIR / "node_modules" / "semver": (dependency_root / "semver").resolve(),
        APP_DIR / "node_modules" / "@img" / "colour": (dependency_root / "@img" / "colour").resolve(),
        APP_DIR / "node_modules" / "@img" / "sharp-win32-x64": (
            dependency_root / "@img" / "sharp-win32-x64"
        ).resolve(),
    }
    for target, source in targets.items():
        if not source.is_dir():
            raise FileNotFoundError(f"Sharp runtime dependency is missing: {source}")
        shutil.copytree(source, target, ignore=shutil.ignore_patterns("node_modules"))


def _copy_node_runtime() -> None:
    source = LauncherPaths.discover(ROOT).node_executable
    if not source.is_file():
        raise FileNotFoundError(f"Node runtime is missing: {source}")
    runtime_dir = RELEASE_DIR / "runtime" / "node"
    runtime_dir.mkdir(parents=True)
    shutil.copy2(source, runtime_dir / "node.exe")
    for dll in source.parent.glob("*.dll"):
        shutil.copy2(dll, runtime_dir / dll.name)


def _build_launcher_executable() -> None:
    try:
        import PyInstaller  # noqa: F401
    except ImportError as error:
        raise RuntimeError(
            "PyInstaller is required for packaging. Install scripts/requirements-build.txt."
        ) from error
    _run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onefile",
            "--windowed",
            "--noupx",
            "--name",
            "LyraLauncher",
            "--icon",
            str(ROOT / "resources" / "branding" / "lyra-app-icon.ico"),
            "--add-data",
            (
                f"{ROOT / 'resources' / 'branding' / 'lyra-app-icon.png'}"
                f"{os.pathsep}resources/branding"
            ),
            "--add-data",
            (
                f"{ROOT / 'resources' / 'branding' / 'lyra-app-icon.ico'}"
                f"{os.pathsep}resources/branding"
            ),
            "--distpath",
            str(RELEASE_DIR),
            "--workpath",
            str(BUILD_DIR / "launcher"),
            "--specpath",
            str(BUILD_DIR / "launcher"),
            "--paths",
            str(ROOT),
            str(ROOT / "main.py"),
        ]
    )


def _smoke_test_release() -> None:
    port = _find_free_port()
    manager = ProcessManager(
        LauncherPaths.discover(RELEASE_DIR),
        port=port,
        startup_timeout=20,
        stop_timeout=8,
    )
    try:
        statuses = manager.start_services()
        if not all(status.running for status in statuses.values()) or not manager.is_api_ready():
            raise RuntimeError("Release services did not pass the readiness check.")
    finally:
        manager.stop_services()
    result = subprocess.run(
        [str(RELEASE_DIR / "LyraLauncher.exe"), "--status", "--base-dir", str(RELEASE_DIR)],
        cwd=RELEASE_DIR,
        timeout=20,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Launcher executable smoke test failed with code {result.returncode}.")


def _stop_existing_release() -> None:
    session = RELEASE_DIR / "data" / "run" / "launcher-session.json"
    if session.exists():
        ProcessManager(LauncherPaths.discover(RELEASE_DIR)).stop_services()


def _reset_release_data() -> None:
    data_dir = RELEASE_DIR / "data"
    _safe_remove(data_dir)
    data_dir.mkdir()
    (data_dir / ".gitkeep").write_text("", encoding="utf-8")


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _safe_remove(path: Path) -> None:
    resolved = path.resolve()
    workspace = ROOT.resolve()
    if resolved == workspace or workspace not in resolved.parents:
        raise RuntimeError(f"Refusing to remove path outside the workspace root: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)


def _run(command: list[str]) -> None:
    subprocess.run(command, cwd=ROOT, check=True)


if __name__ == "__main__":
    raise SystemExit(main())
