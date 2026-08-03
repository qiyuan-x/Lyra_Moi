from __future__ import annotations

import contextlib
import ctypes
import json
import os
import queue
import signal
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable, Iterator
from dataclasses import asdict, dataclass
from pathlib import Path

from .paths import LauncherPaths


@dataclass(frozen=True)
class ProcessRecord:
    role: str
    pid: int
    creation_token: str
    session_id: str
    started_at: str
    command: list[str]

    @classmethod
    def from_json(cls, value: object) -> "ProcessRecord":
        if not isinstance(value, dict):
            raise ValueError("Process record must be an object.")
        command = value.get("command")
        if not isinstance(command, list) or not all(isinstance(item, str) for item in command):
            raise ValueError("Process command is invalid.")
        role = value.get("role")
        pid = value.get("pid")
        creation_token = value.get("creation_token")
        session_id = value.get("session_id")
        started_at = value.get("started_at")
        if role not in {"api", "worker"} or not isinstance(pid, int) or pid < 1:
            raise ValueError("Process identity is invalid.")
        if not all(isinstance(item, str) and item for item in (creation_token, session_id, started_at)):
            raise ValueError("Process metadata is invalid.")
        return cls(role, pid, creation_token, session_id, started_at, list(command))


@dataclass(frozen=True)
class ServiceStatus:
    role: str
    running: bool
    pid: int | None


class ProcessManager:
    def __init__(
        self,
        paths: LauncherPaths,
        host: str = "127.0.0.1",
        port: int = 3000,
        startup_timeout: float = 30.0,
        stop_timeout: float = 8.0,
    ) -> None:
        if not host.strip():
            raise ValueError("Host is required.")
        if port < 1 or port > 65535:
            raise ValueError("Port must be between 1 and 65535.")
        self.paths = paths
        self.host = host.strip()
        self.port = port
        self.startup_timeout = startup_timeout
        self.stop_timeout = stop_timeout
        self._thread_lock = threading.RLock()
        self._children: dict[str, subprocess.Popen[bytes]] = {}
        self.paths.ensure_runtime_directories()

    @property
    def browser_url(self) -> str:
        return f"http://{self.host}:{self.port}/"

    @property
    def health_url(self) -> str:
        return f"http://{self.host}:{self.port}/api/v1/health/ready"

    @property
    def live_url(self) -> str:
        return f"http://{self.host}:{self.port}/api/v1/health/live"

    def get_status(self) -> dict[str, ServiceStatus]:
        with self._thread_lock:
            records = self._load_records()
            statuses: dict[str, ServiceStatus] = {}
            for role in ("api", "worker"):
                record = records.get(role)
                running = bool(record and process_matches(record))
                statuses[role] = ServiceStatus(role, running, record.pid if running and record else None)
            return statuses

    def is_api_ready(self, timeout: float = 1.0) -> bool:
        return self._request_health(self.health_url, timeout)

    def is_api_live(self, timeout: float = 1.0) -> bool:
        return self._request_health(self.live_url, timeout)

    @staticmethod
    def _request_health(url: str, timeout: float) -> bool:
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                return response.status == 200
        except (OSError, urllib.error.URLError, TimeoutError):
            return False

    def start_services(self) -> dict[str, ServiceStatus]:
        with self._thread_lock, self._exclusive_file_lock():
            self.paths.validate_startup_files()
            records = self._refresh_records()
            session_id = next(iter(records.values())).session_id if records else str(uuid.uuid4())
            started_api = False
            started_worker = False

            if "api" not in records:
                if self._port_is_occupied():
                    raise RuntimeError(
                        f"Port {self.port} is occupied by another program. Lyra did not stop that program."
                    )
                records["api"] = self._spawn("api", session_id)
                self._save_records(records)
                started_api = True

            if not self._wait_for_api_live(self.startup_timeout):
                if started_api:
                    self._stop_records([records["api"]])
                    records.pop("api", None)
                    self._save_records(records)
                raise RuntimeError("API process did not become live before the startup timeout.")

            if "worker" not in records:
                try:
                    records["worker"] = self._spawn("worker", session_id)
                    self._save_records(records)
                    started_worker = True
                except Exception:
                    if started_api:
                        self._stop_records([records["api"]])
                        records.pop("api", None)
                        self._save_records(records)
                    raise
            if not self._wait_for_api_ready(self.startup_timeout):
                started_records = [
                    records[role]
                    for role, started in (("worker", started_worker), ("api", started_api))
                    if started
                ]
                self._stop_records(started_records)
                if started_worker:
                    records.pop("worker", None)
                if started_api:
                    records.pop("api", None)
                self._save_records(records)
                raise RuntimeError("Lyra services did not become ready before the startup timeout.")
            return self._status_from_records(records)

    def stop_services(self) -> dict[str, ServiceStatus]:
        with self._thread_lock, self._exclusive_file_lock():
            records = self._refresh_records()
            self._stop_records([records[role] for role in ("worker", "api") if role in records])
            remaining = {role: record for role, record in records.items() if process_matches(record)}
            self._save_records(remaining)
            for role in ("api", "worker"):
                self.paths.stop_file(role).unlink(missing_ok=True)
            return self._status_from_records(remaining)

    def restart_services(self) -> dict[str, ServiceStatus]:
        self.stop_services()
        return self.start_services()

    def _spawn(self, role: str, session_id: str) -> ProcessRecord:
        stop_file = self.paths.stop_file(role)
        stop_file.unlink(missing_ok=True)
        entry = self.paths.api_entry if role == "api" else self.paths.worker_entry
        command = [str(self.paths.node_executable), str(entry)]
        environment = os.environ.copy()
        environment.update(
            {
                "LYRA_DEPLOYMENT_MODE": "desktop",
                "LYRA_DATA_DIR": str(self.paths.data_dir),
                "LYRA_HOST": self.host,
                "LYRA_PORT": str(self.port),
                "LYRA_WEB_DIST": str(self.paths.web_root),
                "LYRA_STOP_FILE": str(stop_file),
                "LYRA_AGENT_SYSTEM_PROMPT_FILE": str(self.paths.system_prompt),
                "NODE_ENV": "production",
            }
        )
        log_path = self.paths.log_file(role)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        creation_flags = 0
        popen_options: dict[str, object] = {}
        if os.name == "nt":
            creation_flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            popen_options["start_new_session"] = True

        with log_path.open("ab", buffering=0) as output:
            process = subprocess.Popen(
                command,
                cwd=self.paths.base_dir,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                creationflags=creation_flags,
                close_fds=True,
                **popen_options,
            )
        token = _wait_for_process_token(process)
        record = ProcessRecord(
            role=role,
            pid=process.pid,
            creation_token=token,
            session_id=session_id,
            started_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            command=command,
        )
        self._children[role] = process
        return record

    def _stop_records(self, records: list[ProcessRecord]) -> None:
        active = [record for record in records if process_matches(record)]
        for record in active:
            self.paths.stop_file(record.role).touch()

        deadline = time.monotonic() + self.stop_timeout
        while active and time.monotonic() < deadline:
            active = [record for record in active if process_matches(record)]
            if active:
                time.sleep(0.1)

        for record in active:
            force_terminate(record)
        force_deadline = time.monotonic() + 3.0
        while active and time.monotonic() < force_deadline:
            active = [record for record in active if process_matches(record)]
            if active:
                time.sleep(0.05)
        if active:
            identities = ", ".join(f"{record.role}:{record.pid}" for record in active)
            raise RuntimeError(f"Lyra processes could not be stopped: {identities}")

    def _wait_for_api_ready(self, timeout: float) -> bool:
        return self._wait_for_api_health(timeout, self.is_api_ready)

    def _wait_for_api_live(self, timeout: float) -> bool:
        return self._wait_for_api_health(timeout, self.is_api_live)

    def _wait_for_api_health(self, timeout: float, check: Callable[[float], bool]) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            api = self._load_records().get("api")
            if api is None or not process_matches(api):
                return False
            if check(min(1.0, max(0.1, deadline - time.monotonic()))):
                return True
            time.sleep(0.2)
        return False

    def _port_is_occupied(self) -> bool:
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
            probe.bind((self.host, self.port))
            return False
        except OSError:
            return True
        finally:
            probe.close()

    def _refresh_records(self) -> dict[str, ProcessRecord]:
        records = self._load_records()
        current = {role: record for role, record in records.items() if process_matches(record)}
        if current != records:
            self._save_records(current)
        return current

    def _load_records(self) -> dict[str, ProcessRecord]:
        if not self.paths.session_file.exists():
            return {}
        try:
            payload = json.loads(self.paths.session_file.read_text(encoding="utf-8"))
            if not isinstance(payload, dict) or payload.get("version") != 1:
                raise ValueError("Unsupported launcher session format.")
            items = payload.get("processes")
            if not isinstance(items, list):
                raise ValueError("Launcher process list is invalid.")
            records = [ProcessRecord.from_json(item) for item in items]
            if len({record.role for record in records}) != len(records):
                raise ValueError("Launcher process roles are duplicated.")
            return {record.role: record for record in records}
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Launcher session file is invalid: {self.paths.session_file}") from error

    def _save_records(self, records: dict[str, ProcessRecord]) -> None:
        self.paths.run_dir.mkdir(parents=True, exist_ok=True)
        if not records:
            self.paths.session_file.unlink(missing_ok=True)
            return
        payload = {
            "version": 1,
            "processes": [asdict(records[role]) for role in ("api", "worker") if role in records],
        }
        temporary = self.paths.session_file.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, self.paths.session_file)

    def _status_from_records(self, records: dict[str, ProcessRecord]) -> dict[str, ServiceStatus]:
        return {
            role: ServiceStatus(role, role in records and process_matches(records[role]), records[role].pid if role in records and process_matches(records[role]) else None)
            for role in ("api", "worker")
        }

    @contextlib.contextmanager
    def _exclusive_file_lock(self) -> Iterator[None]:
        self.paths.run_dir.mkdir(parents=True, exist_ok=True)
        with self.paths.lock_file.open("a+b") as lock:
            lock.seek(0, os.SEEK_END)
            if lock.tell() == 0:
                lock.write(b"0")
                lock.flush()
            lock.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
                try:
                    yield
                finally:
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


class LogTailer:
    def __init__(self, paths: LauncherPaths) -> None:
        self.paths = paths
        self.messages: queue.Queue[str] = queue.Queue(maxsize=5000)
        self._offsets: dict[Path, int] = {}
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="lyra-log-tailer", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=1.0)

    def _run(self) -> None:
        while not self._stop_event.wait(0.3):
            for role in ("api", "worker"):
                self._read_new_lines(role, self.paths.log_file(role))

    def _read_new_lines(self, role: str, path: Path) -> None:
        try:
            size = path.stat().st_size
            previous = self._offsets.get(path)
            if previous is None:
                previous = max(0, size - 128 * 1024)
            if size < previous:
                previous = 0
            with path.open("rb") as source:
                source.seek(previous)
                data = source.read()
                self._offsets[path] = source.tell()
        except OSError:
            return
        if not data:
            return
        for line in data.decode("utf-8", errors="replace").splitlines():
            message = f"[{role.upper()}] {line}"
            try:
                self.messages.put_nowait(message)
            except queue.Full:
                try:
                    self.messages.get_nowait()
                    self.messages.put_nowait(message)
                except queue.Empty:
                    pass


def process_matches(record: ProcessRecord) -> bool:
    token = get_process_creation_token(record.pid)
    return token is not None and token == record.creation_token


def get_process_creation_token(pid: int) -> str | None:
    if pid < 1:
        return None
    if os.name == "nt":
        return _windows_process_token(pid)
    proc_stat = Path(f"/proc/{pid}/stat")
    try:
        fields = proc_stat.read_text(encoding="utf-8").split()
        os.kill(pid, 0)
        return fields[21]
    except (OSError, IndexError):
        return None


def force_terminate(record: ProcessRecord) -> None:
    if not process_matches(record):
        return
    if os.name == "nt":
        _terminate_windows_process(record)
        return
    os.kill(record.pid, signal.SIGTERM)


def _wait_for_process_token(process: subprocess.Popen[bytes]) -> str:
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Process exited during startup with code {process.returncode}.")
        token = get_process_creation_token(process.pid)
        if token is not None:
            return token
        time.sleep(0.02)
    process.terminate()
    raise RuntimeError("Could not record the child process identity.")


def _windows_process_token(pid: int) -> str | None:
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    query_access = 0x1000
    handle = kernel32.OpenProcess(query_access, False, pid)
    if not handle:
        return None
    try:
        exit_code = wintypes.DWORD()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
            return None
        if exit_code.value != 259:
            return None
        creation = wintypes.FILETIME()
        exit_time = wintypes.FILETIME()
        kernel = wintypes.FILETIME()
        user = wintypes.FILETIME()
        if not kernel32.GetProcessTimes(
            handle,
            ctypes.byref(creation),
            ctypes.byref(exit_time),
            ctypes.byref(kernel),
            ctypes.byref(user),
        ):
            return None
        return str((creation.dwHighDateTime << 32) | creation.dwLowDateTime)
    finally:
        kernel32.CloseHandle(handle)


def _terminate_windows_process(record: ProcessRecord) -> None:
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    terminate_access = 0x0001 | 0x1000
    handle = kernel32.OpenProcess(terminate_access, False, record.pid)
    if not handle:
        return
    try:
        creation = wintypes.FILETIME()
        exit_time = wintypes.FILETIME()
        kernel = wintypes.FILETIME()
        user = wintypes.FILETIME()
        if not kernel32.GetProcessTimes(
            handle,
            ctypes.byref(creation),
            ctypes.byref(exit_time),
            ctypes.byref(kernel),
            ctypes.byref(user),
        ):
            return
        token = str((creation.dwHighDateTime << 32) | creation.dwLowDateTime)
        if token != record.creation_token:
            return
        kernel32.TerminateProcess(handle, 1)
    finally:
        kernel32.CloseHandle(handle)
