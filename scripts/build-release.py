from __future__ import annotations

import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = ROOT / "build"
RELEASE_DIR = ROOT / "release"
APP_DIR = RELEASE_DIR / "app"
UPDATE_MANIFEST_URL = "https://linfrsot.cloud/lyra/updates/latest.json"
UPDATE_PACKAGE_BASE_URL = "https://linfrsot.cloud/lyra/updates/packages"
RELEASE_NOTES = (
    "图片生成统一支持自动、1K、2K 和 4K 分辨率设置。",
    "动作参考复位时同时恢复默认动作和镜头。",
    "统一供应商的添加、配置、启停和删除操作。",
    "默认提供 OpenAI、Gemini、FrostAPI 配置入口。",
)
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
    _write_release_manifest()
    _build_update_archive()
    _build_portable_archive()
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


def _application_version() -> str:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    version = package.get("version")
    if not isinstance(version, str) or not version.strip():
        raise RuntimeError("Root package.json version is missing.")
    return version.strip()


def _write_release_manifest() -> None:
    payload = {
        "schemaVersion": 1,
        "version": _application_version(),
        "platform": "windows-x64",
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "updateManifestUrl": UPDATE_MANIFEST_URL,
    }
    (RELEASE_DIR / "release.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _build_update_archive() -> None:
    version = _application_version()
    archive = RELEASE_DIR / f"Lyra-update-{version}-windows-x64.zip"
    with zipfile.ZipFile(
        archive,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as bundle:
        bundle.write(RELEASE_DIR / "release.json", "release.json")
        bundle.write(RELEASE_DIR / "LyraLauncher.exe", "LyraLauncher.exe")
        for source in sorted(APP_DIR.rglob("*")):
            if source.is_file():
                bundle.write(source, source.relative_to(RELEASE_DIR).as_posix())
    checksum = hashlib.sha256()
    with archive.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(chunk)
    metadata = {
        "schemaVersion": 1,
        "version": version,
        "platform": "windows-x64",
        "fileName": archive.name,
        "size": archive.stat().st_size,
        "sha256": checksum.hexdigest(),
    }
    (RELEASE_DIR / "update-artifact.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    release = json.loads((RELEASE_DIR / "release.json").read_text(encoding="utf-8"))
    latest = {
        "schemaVersion": 1,
        "version": version,
        "publishedAt": release["builtAt"],
        "releaseNotes": list(RELEASE_NOTES),
        "artifacts": {
            "windows-x64": {
                "url": f"{UPDATE_PACKAGE_BASE_URL}/{archive.name}",
                "size": metadata["size"],
                "sha256": metadata["sha256"],
            }
        },
    }
    (RELEASE_DIR / "latest.json").write_text(
        json.dumps(latest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _build_portable_archive() -> None:
    version = _application_version()
    archive = RELEASE_DIR / f"Lyra-{version}-windows-x64.zip"
    with zipfile.ZipFile(
        archive,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as bundle:
        for relative in (Path("LyraLauncher.exe"), Path("release.json")):
            bundle.write(RELEASE_DIR / relative, relative.as_posix())
        bundle.writestr("data/.gitkeep", "")
        for directory in (APP_DIR, RELEASE_DIR / "runtime"):
            for source in sorted(directory.rglob("*")):
                if source.is_file():
                    bundle.write(source, source.relative_to(RELEASE_DIR).as_posix())


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
        request_file = _write_update_smoke_request(port)
        updater = RELEASE_DIR / "data" / "temp" / "updater" / "LyraUpdater.exe"
        updater.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(RELEASE_DIR / "LyraLauncher.exe", updater)
        update_result = subprocess.run(
            [
                str(updater),
                "--base-dir",
                str(RELEASE_DIR),
                "--apply-update",
                str(request_file),
            ],
            cwd=RELEASE_DIR,
            timeout=90,
            check=False,
        )
        if update_result.returncode != 0 or not manager.is_api_ready(timeout=3):
            raise RuntimeError(
                f"Packaged updater smoke test failed with code {update_result.returncode}."
            )
        update_state = json.loads(
            (RELEASE_DIR / "data" / "run" / "application-update-state.json").read_text(
                encoding="utf-8"
            )
        )
        if update_state.get("snapshot", {}).get("status") != "completed":
            raise RuntimeError("Packaged updater did not report a completed state.")
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


def _write_update_smoke_request(port: int) -> Path:
    metadata = json.loads((RELEASE_DIR / "update-artifact.json").read_text(encoding="utf-8"))
    version = _application_version()
    state_file = RELEASE_DIR / "data" / "run" / "application-update-state.json"
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "snapshot": {
                    "enabled": True,
                    "currentVersion": version,
                    "latestVersion": version,
                    "platform": "windows-x64",
                    "updateAvailable": True,
                    "status": "scheduled",
                    "progress": 0,
                    "message": "packaged updater smoke test",
                    "checkedAt": None,
                    "publishedAt": None,
                    "releaseNotes": [],
                    "artifactSize": metadata["size"],
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    request_file = RELEASE_DIR / "data" / "run" / "application-update-request.json"
    request_file.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "baseDir": str(RELEASE_DIR),
                "currentVersion": version,
                "targetVersion": version,
                "platform": "windows-x64",
                "artifact": {
                    "url": (RELEASE_DIR / metadata["fileName"]).as_uri(),
                    "sha256": metadata["sha256"],
                    "size": metadata["size"],
                },
                "stateFile": str(state_file),
                "port": port,
                "updateLauncher": True,
                "restartLauncher": False,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return request_file


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
