from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from .paths import LauncherPaths
from .process_manager import ProcessManager


@dataclass(frozen=True)
class DesktopUpdateCandidate:
    version: str
    published_at: str
    release_notes: tuple[str, ...]
    artifact_url: str
    artifact_sha256: str
    artifact_size: int


@dataclass(frozen=True)
class DesktopUpdateCheck:
    enabled: bool
    current_version: str
    latest_version: str | None
    update_available: bool
    published_at: str | None
    release_notes: tuple[str, ...]
    artifact_size: int | None
    candidate: DesktopUpdateCandidate | None


class DesktopUpdateClient:
    def __init__(self, paths: LauncherPaths) -> None:
        self.paths = paths

    @property
    def enabled(self) -> bool:
        return bool(self.paths.update_manifest_url)

    def check(self) -> DesktopUpdateCheck:
        manifest_url = self.paths.update_manifest_url
        current_version = self.paths.application_version
        if not manifest_url:
            return DesktopUpdateCheck(
                enabled=False,
                current_version=current_version,
                latest_version=None,
                update_available=False,
                published_at=None,
                release_notes=(),
                artifact_size=None,
                candidate=None,
            )
        try:
            request = urllib.request.Request(
                manifest_url,
                headers={"Accept": "application/json", "User-Agent": "Lyra-Launcher/1"},
            )
            with urllib.request.urlopen(request, timeout=15) as response:
                manifest = json.load(response)
            candidate = _parse_update_manifest(manifest)
            available = _compare_versions(candidate.version, current_version) > 0
            result = DesktopUpdateCheck(
                enabled=True,
                current_version=current_version,
                latest_version=candidate.version,
                update_available=available,
                published_at=candidate.published_at,
                release_notes=candidate.release_notes,
                artifact_size=candidate.artifact_size,
                candidate=candidate if available else None,
            )
            _write_update_check_state(self.paths.update_state_file, result)
            return result
        except (OSError, ValueError, TypeError, urllib.error.URLError) as error:
            message = f"检查更新失败：{error}"
            _write_update_failure_state(
                self.paths.update_state_file,
                current_version,
                message,
            )
            raise RuntimeError(message) from error

    def start_update(self, candidate: DesktopUpdateCandidate, port: int) -> None:
        packaged_launcher = self.paths.base_dir / "LyraLauncher.exe"
        if not packaged_launcher.is_file():
            raise RuntimeError("一键升级仅支持 Windows 发布版。")
        self.paths.ensure_runtime_directories()
        request = {
            "schemaVersion": 1,
            "baseDir": str(self.paths.base_dir),
            "currentVersion": self.paths.application_version,
            "targetVersion": candidate.version,
            "platform": "windows-x64",
            "artifact": {
                "url": candidate.artifact_url,
                "sha256": candidate.artifact_sha256,
                "size": candidate.artifact_size,
            },
            "stateFile": str(self.paths.update_state_file),
            "port": port,
            "updateLauncher": True,
            "restartLauncher": True,
        }
        _write_json_atomic(self.paths.update_request_file, request)
        _write_update_scheduled_state(
            self.paths.update_state_file,
            self.paths.application_version,
            candidate,
        )

        helper_dir = self.paths.data_dir / "temp" / "updater"
        helper_dir.mkdir(parents=True, exist_ok=True)
        helper = helper_dir / "LyraUpdater.exe"
        shutil.copy2(packaged_launcher, helper)
        command = [
            str(helper),
            "--base-dir",
            str(self.paths.base_dir),
            "--apply-update",
            str(self.paths.update_request_file),
        ]
        options: dict[str, object] = {
            "cwd": str(self.paths.base_dir),
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
        subprocess.Popen(command, **options)


class DesktopUpdateInstaller:
    def __init__(
        self,
        paths: LauncherPaths,
        manager_factory: Callable[[LauncherPaths, int], ProcessManager] | None = None,
    ) -> None:
        self.paths = paths
        self.manager_factory = manager_factory or (
            lambda launcher_paths, port: ProcessManager(launcher_paths, port=port)
        )

    def apply(self, request_file: Path | str) -> None:
        request_path = Path(request_file).expanduser().resolve()
        request = _read_update_request(request_path, self.paths.base_dir)
        state_file = Path(request["stateFile"]).resolve()
        target_version = request["targetVersion"]
        current_version = request["currentVersion"]
        artifact = request["artifact"]
        update_root = self.paths.data_dir / "temp" / "updates"
        update_root.mkdir(parents=True, exist_ok=True)
        workspace = Path(tempfile.mkdtemp(prefix=f"{target_version}-", dir=update_root))
        archive = workspace / "application-update.zip"
        staging = workspace / "staging"
        manager = self.manager_factory(self.paths, request["port"])
        services_stopped = False
        application_swapped = False
        backup_dir: Path | None = None
        previous_release: bytes | None = None
        try:
            self._write_status(
                state_file,
                "downloading",
                "正在下载安装包。",
                0,
            )
            _download(
                artifact["url"],
                archive,
                artifact["size"],
                lambda progress: self._write_status(
                    state_file,
                    "downloading",
                    "正在下载安装包。",
                    progress,
                ),
            )
            self._write_status(state_file, "verifying", "正在校验安装包。", 100)
            _verify_sha256(archive, artifact["sha256"])
            _extract_update_archive(archive, staging)
            include_launcher = bool(request.get("updateLauncher"))
            _validate_staged_application(staging, target_version, include_launcher)

            self._write_status(state_file, "installing", "正在停止服务并安装新版本。", None)
            manager.stop_services()
            services_stopped = True
            backup_dir = _create_backup(self.paths, current_version, target_version)
            previous_release = _read_optional_bytes(self.paths.release_manifest)
            if previous_release is None:
                previous_release = _read_optional_bytes(
                    self.paths.legacy_release_manifest
                )
            _backup_current_installation(
                self.paths,
                backup_dir,
                previous_release,
                include_launcher,
            )
            application_swapped = True
            _install_staged_application(
                self.paths,
                staging,
                target_version,
                include_launcher,
            )

            self._write_status(
                state_file,
                "restarting",
                "安装完成，正在启动新版本。",
                None,
                current_version=target_version,
            )
            manager.start_services()
            if not manager.is_api_ready(timeout=2.0):
                raise RuntimeError("新版本未通过服务健康检查。")
            self._write_status(
                state_file,
                "completed",
                "升级完成。",
                100,
                current_version=target_version,
                update_available=False,
            )
            request_path.unlink(missing_ok=True)
        except Exception as error:
            rollback_error: Exception | None = None
            if backup_dir is not None and (
                application_swapped or (backup_dir / "application").is_dir()
            ):
                try:
                    self._write_status(
                        state_file,
                        "rolling_back",
                        "新版本启动失败，正在回滚。",
                        None,
                        current_version=current_version,
                    )
                    manager.stop_services()
                    _rollback_installation(self.paths, backup_dir, previous_release)
                    manager.start_services()
                except Exception as rollback_failure:
                    rollback_error = rollback_failure
            elif services_stopped:
                try:
                    manager.start_services()
                except Exception as restart_failure:
                    rollback_error = restart_failure
            message = f"升级失败：{error}"
            if rollback_error is not None:
                message += f"；回滚启动失败：{rollback_error}"
            self._write_status(
                state_file,
                "failed",
                message,
                None,
                current_version=current_version,
            )
            raise
        finally:
            shutil.rmtree(workspace, ignore_errors=True)

    @staticmethod
    def _write_status(
        state_file: Path,
        status: str,
        message: str,
        progress: int | None,
        *,
        current_version: str | None = None,
        update_available: bool | None = None,
    ) -> None:
        _update_state(
            state_file,
            status,
            message,
            progress,
            current_version=current_version,
            update_available=update_available,
        )


def _read_update_request(request_file: Path, expected_base_dir: Path) -> dict[str, object]:
    try:
        value = json.loads(request_file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise RuntimeError(f"更新请求无效：{request_file}") from error
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise RuntimeError("更新请求版本无效。")
    required_strings = (
        "baseDir",
        "currentVersion",
        "targetVersion",
        "platform",
        "stateFile",
    )
    if any(not isinstance(value.get(key), str) or not value[key].strip() for key in required_strings):
        raise RuntimeError("更新请求缺少必要字段。")
    if Path(value["baseDir"]).resolve() != expected_base_dir.resolve():
        raise RuntimeError("更新目录与启动器目录不一致。")
    if value["platform"] != "windows-x64":
        raise RuntimeError("更新包平台不受支持。")
    port = value.get("port")
    if not isinstance(port, int) or isinstance(port, bool) or port < 1 or port > 65535:
        raise RuntimeError("更新服务端口无效。")
    artifact = value.get("artifact")
    if not isinstance(artifact, dict):
        raise RuntimeError("更新包信息无效。")
    if not isinstance(artifact.get("url"), str) or not artifact["url"].strip():
        raise RuntimeError("更新包地址无效。")
    sha256 = artifact.get("sha256")
    size = artifact.get("size")
    if not isinstance(sha256, str) or len(sha256) != 64:
        raise RuntimeError("更新包 SHA-256 无效。")
    if not isinstance(size, int) or isinstance(size, bool) or size < 1:
        raise RuntimeError("更新包大小无效。")
    for key in ("updateLauncher", "restartLauncher"):
        if key in value and not isinstance(value[key], bool):
            raise RuntimeError("更新启动器配置无效。")
    return value


def _download(
    url: str,
    destination: Path,
    expected_size: int,
    on_progress: Callable[[int], None],
) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "Lyra-Updater/1"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as output:
            received = 0
            last_progress = -1
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                received += len(chunk)
                if received > expected_size:
                    raise RuntimeError("下载内容大于更新清单声明的大小。")
                output.write(chunk)
                progress = min(100, int(received * 100 / expected_size))
                if progress != last_progress:
                    last_progress = progress
                    on_progress(progress)
    except (OSError, urllib.error.URLError) as error:
        raise RuntimeError(f"下载安装包失败：{error}") from error
    if destination.stat().st_size != expected_size:
        raise RuntimeError("安装包大小与更新清单不一致。")


def _verify_sha256(archive: Path, expected: str) -> None:
    digest = hashlib.sha256()
    with archive.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest().lower() != expected.lower():
        raise RuntimeError("安装包 SHA-256 校验失败。")


def _extract_update_archive(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(archive) as bundle:
            entries = bundle.infolist()
            if len(entries) > 20_000:
                raise RuntimeError("安装包文件数量异常。")
            if sum(item.file_size for item in entries) > 4 * 1024 * 1024 * 1024:
                raise RuntimeError("安装包解压大小异常。")
            for entry in entries:
                parts = _safe_zip_parts(entry)
                if not parts:
                    continue
                target = destination.joinpath(*parts)
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(entry) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output, 1024 * 1024)
    except zipfile.BadZipFile as error:
        raise RuntimeError("安装包不是有效的 ZIP 文件。") from error


def _safe_zip_parts(entry: zipfile.ZipInfo) -> tuple[str, ...]:
    name = entry.filename
    path = PurePosixPath(name)
    unix_mode = entry.external_attr >> 16
    if stat.S_ISLNK(unix_mode):
        raise RuntimeError("安装包不能包含符号链接。")
    if (
        not name
        or "\\" in name
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
        or any(":" in part for part in path.parts)
    ):
        raise RuntimeError(f"安装包包含不安全路径：{name}")
    return tuple(path.parts)


def _validate_staged_application(
    staging: Path,
    target_version: str,
    include_launcher: bool = False,
) -> None:
    required = [
        staging / "app" / "api" / "run.js",
        staging / "app" / "worker" / "run.js",
        staging / "app" / "worker" / "resources" / "agent-system-v1.txt",
        staging / "app" / "web" / "index.html",
    ]
    if include_launcher:
        required.append(staging / "LyraLauncher.exe")
    missing = [str(path.relative_to(staging)) for path in required if not path.is_file()]
    manifest_path = _staged_release_manifest(staging)
    if manifest_path is None:
        missing.append("app/release.json")
    if missing:
        raise RuntimeError("安装包缺少运行文件：" + ", ".join(missing))
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise RuntimeError("安装包 release.json 无效。") from error
    if not isinstance(manifest, dict) or manifest.get("version") != target_version:
        raise RuntimeError("安装包版本与更新清单不一致。")


def _create_backup(paths: LauncherPaths, current_version: str, target_version: str) -> Path:
    timestamp = time.strftime("%Y%m%d-%H%M%S", time.localtime())
    backup = paths.data_dir / "backups" / f"update-{timestamp}-{current_version}-to-{target_version}"
    suffix = 1
    while backup.exists():
        backup = backup.with_name(f"{backup.name}-{suffix}")
        suffix += 1
    backup.mkdir(parents=True)
    return backup


def _backup_current_installation(
    paths: LauncherPaths,
    backup_dir: Path,
    previous_release: bytes | None,
    include_launcher: bool = False,
) -> None:
    application = paths.base_dir / "app"
    if not application.is_dir():
        raise RuntimeError("当前应用目录不存在。")
    database = paths.data_dir / "database"
    if database.exists():
        shutil.copytree(database, backup_dir / "database")
    shutil.move(str(application), str(backup_dir / "application"))
    if include_launcher:
        launcher = paths.base_dir / "LyraLauncher.exe"
        if not launcher.is_file():
            raise RuntimeError("当前启动器不存在。")
        shutil.copy2(launcher, backup_dir / "LyraLauncher.exe")
    if previous_release is not None:
        (backup_dir / "release.json").write_bytes(previous_release)


def _install_staged_application(
    paths: LauncherPaths,
    staging: Path,
    target_version: str,
    include_launcher: bool = False,
) -> None:
    manifest_path = _staged_release_manifest(staging)
    if manifest_path is None:
        raise RuntimeError("安装包 release.json 无效。")
    release = json.loads(manifest_path.read_text(encoding="utf-8"))
    application = paths.base_dir / "app"
    shutil.move(str(staging / "app"), str(application))
    release["version"] = target_version
    _write_json_atomic(paths.release_manifest, release)
    paths.legacy_release_manifest.unlink(missing_ok=True)
    if include_launcher:
        os.replace(staging / "LyraLauncher.exe", paths.base_dir / "LyraLauncher.exe")


def _rollback_installation(
    paths: LauncherPaths,
    backup_dir: Path,
    previous_release: bytes | None,
) -> None:
    application = paths.base_dir / "app"
    if application.exists():
        shutil.rmtree(application)
    shutil.copytree(backup_dir / "application", application)
    database = paths.data_dir / "database"
    database_backup = backup_dir / "database"
    if database.exists():
        shutil.rmtree(database)
    if database_backup.exists():
        shutil.copytree(database_backup, database)
    if previous_release is None:
        paths.release_manifest.unlink(missing_ok=True)
    else:
        _write_bytes_atomic(paths.release_manifest, previous_release)
    paths.legacy_release_manifest.unlink(missing_ok=True)
    launcher_backup = backup_dir / "LyraLauncher.exe"
    if launcher_backup.is_file():
        shutil.copy2(launcher_backup, paths.base_dir / "LyraLauncher.exe")


def _staged_release_manifest(staging: Path) -> Path | None:
    for path in (staging / "app" / "release.json", staging / "release.json"):
        if path.is_file():
            return path
    return None


def _parse_update_manifest(value: object) -> DesktopUpdateCandidate:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("更新清单格式无效。")
    version = value.get("version")
    if not isinstance(version, str) or not _is_version(version):
        raise ValueError("更新版本号无效。")
    published_at = value.get("publishedAt")
    if not isinstance(published_at, str) or not published_at.strip():
        raise ValueError("更新发布时间无效。")
    release_notes = value.get("releaseNotes")
    if not isinstance(release_notes, list) or any(
        not isinstance(note, str) for note in release_notes
    ):
        raise ValueError("更新说明无效。")
    artifacts = value.get("artifacts")
    artifact = artifacts.get("windows-x64") if isinstance(artifacts, dict) else None
    if not isinstance(artifact, dict):
        raise ValueError("更新清单缺少 Windows 安装包。")
    artifact_url = artifact.get("url")
    parsed_url = urllib.parse.urlparse(artifact_url) if isinstance(artifact_url, str) else None
    if parsed_url is None or parsed_url.scheme not in {"http", "https"}:
        raise ValueError("更新包地址无效。")
    sha256 = artifact.get("sha256")
    if not isinstance(sha256, str) or len(sha256) != 64 or any(
        character not in "0123456789abcdefABCDEF" for character in sha256
    ):
        raise ValueError("更新包 SHA-256 无效。")
    size = artifact.get("size")
    if not isinstance(size, int) or isinstance(size, bool) or size < 1:
        raise ValueError("更新包大小无效。")
    return DesktopUpdateCandidate(
        version=version.strip(),
        published_at=published_at.strip(),
        release_notes=tuple(note.strip() for note in release_notes if note.strip()),
        artifact_url=artifact_url.strip(),
        artifact_sha256=sha256.lower(),
        artifact_size=size,
    )


def _is_version(value: str) -> bool:
    parts = value.strip().split(".")
    return len(parts) == 3 and all(part.isdigit() for part in parts)


def _compare_versions(left: str, right: str) -> int:
    if not _is_version(left) or not _is_version(right):
        raise ValueError("版本号必须使用 major.minor.patch 格式。")
    left_parts = tuple(int(part) for part in left.split("."))
    right_parts = tuple(int(part) for part in right.split("."))
    return (left_parts > right_parts) - (left_parts < right_parts)


def _snapshot_payload(
    current_version: str,
    *,
    latest_version: str | None,
    update_available: bool,
    status: str,
    message: str,
    published_at: str | None = None,
    release_notes: tuple[str, ...] = (),
    artifact_size: int | None = None,
    progress: int | None = None,
) -> dict[str, object]:
    return {
        "enabled": True,
        "currentVersion": current_version,
        "latestVersion": latest_version,
        "platform": "windows-x64",
        "updateAvailable": update_available,
        "status": status,
        "progress": progress,
        "message": message,
        "checkedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "publishedAt": published_at,
        "releaseNotes": list(release_notes),
        "artifactSize": artifact_size,
    }


def _write_update_check_state(state_file: Path, result: DesktopUpdateCheck) -> None:
    snapshot = _snapshot_payload(
        result.current_version,
        latest_version=result.latest_version,
        update_available=result.update_available,
        status="available" if result.update_available else "current",
        message="发现新版本。" if result.update_available else "已是最新版本。",
        published_at=result.published_at,
        release_notes=result.release_notes,
        artifact_size=result.artifact_size,
    )
    state: dict[str, object] = {"schemaVersion": 1, "snapshot": snapshot}
    if result.candidate is not None:
        state["candidate"] = {
            "version": result.candidate.version,
            "artifact": {
                "url": result.candidate.artifact_url,
                "sha256": result.candidate.artifact_sha256,
                "size": result.candidate.artifact_size,
            },
        }
    _write_json_atomic(state_file, state)


def _write_update_scheduled_state(
    state_file: Path,
    current_version: str,
    candidate: DesktopUpdateCandidate,
) -> None:
    result = DesktopUpdateCheck(
        enabled=True,
        current_version=current_version,
        latest_version=candidate.version,
        update_available=True,
        published_at=candidate.published_at,
        release_notes=candidate.release_notes,
        artifact_size=candidate.artifact_size,
        candidate=candidate,
    )
    _write_update_check_state(state_file, result)
    state = json.loads(state_file.read_text(encoding="utf-8"))
    state["snapshot"].update(
        {"status": "scheduled", "message": "升级任务已提交，正在启动更新程序。", "progress": 0}
    )
    _write_json_atomic(state_file, state)


def _write_update_failure_state(
    state_file: Path,
    current_version: str,
    message: str,
) -> None:
    _write_json_atomic(
        state_file,
        {
            "schemaVersion": 1,
            "snapshot": _snapshot_payload(
                current_version,
                latest_version=None,
                update_available=False,
                status="failed",
                message=message,
            ),
        },
    )


def _update_state(
    state_file: Path,
    status: str,
    message: str,
    progress: int | None,
    *,
    current_version: str | None,
    update_available: bool | None,
) -> None:
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {"schemaVersion": 1, "snapshot": {}}
    if not isinstance(state, dict):
        state = {"schemaVersion": 1, "snapshot": {}}
    snapshot = state.get("snapshot")
    if not isinstance(snapshot, dict):
        snapshot = {}
    snapshot.update({"status": status, "message": message, "progress": progress})
    if current_version is not None:
        snapshot["currentVersion"] = current_version
    if update_available is not None:
        snapshot["updateAvailable"] = update_available
    state["schemaVersion"] = 1
    state["snapshot"] = snapshot
    _write_json_atomic(state_file, state)


def _read_optional_bytes(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def _write_json_atomic(path: Path, value: object) -> None:
    _write_bytes_atomic(
        path,
        (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )


def _write_bytes_atomic(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.{os.getpid()}.tmp")
    temporary.write_bytes(value)
    try:
        for attempt in range(10):
            try:
                os.replace(temporary, path)
                return
            except PermissionError:
                if attempt == 9:
                    raise
                time.sleep(0.05 * (attempt + 1))
    finally:
        temporary.unlink(missing_ok=True)
