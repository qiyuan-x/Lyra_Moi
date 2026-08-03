from __future__ import annotations

import ctypes
import queue
import sys
import threading
import tkinter as tk
import webbrowser
from collections.abc import Callable
from pathlib import Path
from tkinter import messagebox, ttk

from .paths import LauncherPaths
from .process_manager import LogTailer, ProcessManager, ServiceStatus

LYRA_VERSION = "0.0.1"


def enable_high_dpi() -> None:
    if not hasattr(ctypes, "windll"):
        return
    try:
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except (AttributeError, OSError):
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except (AttributeError, OSError):
            pass


class LyraLauncher(tk.Tk):
    def __init__(self, manager: ProcessManager | None = None) -> None:
        enable_high_dpi()
        super().__init__()
        self.manager = manager or ProcessManager(LauncherPaths.discover())
        self.title(f"Lyra 服务启动器 {LYRA_VERSION}")
        self.minsize(760, 540)
        self.geometry(self._centered_geometry(920, 680))
        self._apply_window_icon()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

        self._busy = False
        self._action_messages: queue.Queue[tuple[str, object, bool, bool]] = queue.Queue()
        self._status_labels: dict[str, ttk.Label] = {}
        self._action_buttons: list[ttk.Button] = []
        self._log_tailer = LogTailer(self.manager.paths)
        self._log_tailer.start()

        self._configure_style()
        self._build_interface()
        self.after(100, self._drain_queues)
        self.after(250, self._refresh_status)

    def _apply_window_icon(self) -> None:
        resource_root = (
            Path(getattr(sys, "_MEIPASS"))
            if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")
            else Path(__file__).resolve().parents[2]
        )
        branding = resource_root / "resources" / "branding"
        try:
            self._window_icon = tk.PhotoImage(file=branding / "lyra-app-icon.png")
            self.iconphoto(True, self._window_icon)
        except (OSError, tk.TclError):
            self._window_icon = None
        if sys.platform == "win32":
            try:
                self.iconbitmap(default=branding / "lyra-app-icon.ico")
            except (OSError, tk.TclError):
                pass

    def _configure_style(self) -> None:
        style = ttk.Style(self)
        if "vista" in style.theme_names():
            style.theme_use("vista")
        style.configure("Title.TLabel", font=("Microsoft YaHei UI", 18, "bold"))
        style.configure("Subtitle.TLabel", font=("Microsoft YaHei UI", 10), foreground="#5f6876")
        style.configure("ServiceTitle.TLabel", font=("Microsoft YaHei UI", 11, "bold"))
        style.configure("ServiceState.TLabel", font=("Microsoft YaHei UI", 10))
        style.configure("Status.TLabel", font=("Microsoft YaHei UI", 9), foreground="#5f6876")
        style.configure("Primary.TButton", font=("Microsoft YaHei UI", 10, "bold"), padding=(16, 8))
        style.configure("Action.TButton", font=("Microsoft YaHei UI", 10), padding=(14, 8))

    def _build_interface(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(3, weight=1)

        header = ttk.Frame(self, padding=(22, 18, 22, 10))
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)
        ttk.Label(header, text="Lyra 服务启动器", style="Title.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(
            header,
            text="管理本机 API 与 Worker 服务。启动成功后自动打开浏览器。",
            style="Subtitle.TLabel",
        ).grid(row=1, column=0, sticky="w", pady=(5, 0))

        services = ttk.Frame(self, padding=(22, 6, 22, 8))
        services.grid(row=1, column=0, sticky="ew")
        services.columnconfigure((0, 1), weight=1, uniform="service")
        self._create_service_card(services, "api", "API 与前端", 0)
        self._create_service_card(services, "worker", "Agent 与生图 Worker", 1)

        actions = ttk.Frame(self, padding=(22, 4, 22, 12))
        actions.grid(row=2, column=0, sticky="ew")
        for column in range(5):
            actions.columnconfigure(column, weight=1)
        self._add_action_button(actions, "启动服务", self._start_services, 0, "Primary.TButton")
        self._add_action_button(actions, "停止服务", self._stop_services, 1)
        self._add_action_button(actions, "重启服务", self._restart_services, 2)
        self._add_action_button(actions, "打开浏览器", self._open_browser, 3)
        self._add_action_button(actions, "清空显示", self._clear_log, 4)

        log_frame = ttk.LabelFrame(self, text="运行日志", padding=(10, 8))
        log_frame.grid(row=3, column=0, sticky="nsew", padx=22, pady=(0, 10))
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        self.log_view = tk.Text(
            log_frame,
            wrap="word",
            state="disabled",
            font=("Cascadia Mono", 9),
            background="#111827",
            foreground="#d7e0ee",
            insertbackground="#d7e0ee",
            borderwidth=0,
            padx=10,
            pady=8,
        )
        scrollbar = ttk.Scrollbar(log_frame, orient="vertical", command=self.log_view.yview)
        self.log_view.configure(yscrollcommand=scrollbar.set)
        self.log_view.grid(row=0, column=0, sticky="nsew")
        scrollbar.grid(row=0, column=1, sticky="ns")

        self.footer_status = tk.StringVar(value="就绪")
        footer = ttk.Label(
            self,
            textvariable=self.footer_status,
            style="Status.TLabel",
            padding=(22, 0, 22, 12),
        )
        footer.grid(row=4, column=0, sticky="ew")

    def _create_service_card(self, parent: ttk.Frame, role: str, title: str, column: int) -> None:
        card = ttk.LabelFrame(parent, padding=(14, 10))
        card.grid(row=0, column=column, sticky="ew", padx=(0, 6) if column == 0 else (6, 0))
        card.columnconfigure(1, weight=1)
        ttk.Label(card, text=title, style="ServiceTitle.TLabel").grid(row=0, column=0, sticky="w")
        state = ttk.Label(card, text="检查中", style="ServiceState.TLabel")
        state.grid(row=0, column=1, sticky="e")
        self._status_labels[role] = state

    def _add_action_button(
        self,
        parent: ttk.Frame,
        text: str,
        command: Callable[[], None],
        column: int,
        style: str = "Action.TButton",
    ) -> None:
        button = ttk.Button(parent, text=text, command=command, style=style)
        button.grid(row=0, column=column, sticky="ew", padx=(0 if column == 0 else 5, 0))
        self._action_buttons.append(button)

    def _start_services(self) -> None:
        self._run_action("正在启动服务…", self.manager.start_services, open_after=True)

    def _stop_services(self) -> None:
        self._run_action("正在停止服务…", self.manager.stop_services)

    def _restart_services(self) -> None:
        self._run_action("正在重启服务…", self.manager.restart_services, open_after=True)

    def _open_browser(self) -> None:
        webbrowser.open(self.manager.browser_url)

    def _clear_log(self) -> None:
        self.log_view.configure(state="normal")
        self.log_view.delete("1.0", "end")
        self.log_view.configure(state="disabled")

    def _run_action(
        self,
        label: str,
        operation: Callable[[], object],
        open_after: bool = False,
        close_after: bool = False,
    ) -> None:
        if self._busy:
            return
        self._busy = True
        self.footer_status.set(label)
        self._set_buttons_enabled(False)

        def execute() -> None:
            try:
                result = operation()
                self._action_messages.put(("success", result, open_after, close_after))
            except Exception as error:
                self._action_messages.put(("error", error, False, close_after))

        threading.Thread(target=execute, name="lyra-launcher-action", daemon=True).start()

    def _drain_queues(self) -> None:
        try:
            while True:
                message = self._log_tailer.messages.get_nowait()
                self._append_log(message)
        except queue.Empty:
            pass

        try:
            while True:
                kind, value, open_after, close_after = self._action_messages.get_nowait()
                self._busy = False
                self._set_buttons_enabled(True)
                if kind == "error":
                    self.footer_status.set("操作失败")
                    messagebox.showerror("操作失败", str(value), parent=self)
                else:
                    self.footer_status.set("操作完成")
                    self._apply_status(value if isinstance(value, dict) else self.manager.get_status())
                    if open_after:
                        webbrowser.open(self.manager.browser_url)
                    if close_after:
                        self._destroy_launcher()
                        return
        except queue.Empty:
            pass
        self.after(100, self._drain_queues)

    def _refresh_status(self) -> None:
        if not self._busy:
            try:
                self._apply_status(self.manager.get_status())
            except RuntimeError as error:
                self.footer_status.set(str(error))
        self.after(1000, self._refresh_status)

    def _apply_status(self, statuses: dict[str, ServiceStatus]) -> None:
        for role, label in self._status_labels.items():
            status = statuses.get(role)
            if status and status.running:
                label.configure(text=f"运行中 · PID {status.pid}", foreground="#147a45")
            else:
                label.configure(text="已停止", foreground="#8a3c3c")

    def _append_log(self, message: str) -> None:
        self.log_view.configure(state="normal")
        self.log_view.insert("end", message + "\n")
        line_count = int(self.log_view.index("end-1c").split(".", 1)[0])
        if line_count > 5000:
            self.log_view.delete("1.0", f"{line_count - 4500}.0")
        self.log_view.see("end")
        self.log_view.configure(state="disabled")

    def _set_buttons_enabled(self, enabled: bool) -> None:
        state = "normal" if enabled else "disabled"
        for button in self._action_buttons:
            button.configure(state=state)

    def _on_close(self) -> None:
        if self._busy:
            messagebox.showinfo("请稍候", "当前操作完成后再退出。", parent=self)
            return
        statuses = self.manager.get_status()
        if not any(status.running for status in statuses.values()):
            self._destroy_launcher()
            return
        answer = messagebox.askyesnocancel(
            "退出启动器",
            "退出前是否停止 Lyra 服务？\n\n是：停止服务并退出\n否：保留服务并退出",
            parent=self,
        )
        if answer is None:
            return
        if answer:
            self._run_action("正在停止服务并退出…", self.manager.stop_services, close_after=True)
        else:
            self._destroy_launcher()

    def _destroy_launcher(self) -> None:
        self._log_tailer.stop()
        self.destroy()

    def _centered_geometry(self, width: int, height: int) -> str:
        screen_width = self.winfo_screenwidth()
        screen_height = self.winfo_screenheight()
        x = max(0, (screen_width - width) // 2)
        y = max(0, (screen_height - height) // 2)
        return f"{width}x{height}+{x}+{y}"
