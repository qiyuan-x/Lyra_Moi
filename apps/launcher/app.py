from __future__ import annotations

import ctypes
import queue
import sys
import threading
import time
import tkinter as tk
import webbrowser
from collections.abc import Callable
from pathlib import Path
from tkinter import messagebox, ttk

from .paths import LauncherPaths
from .process_manager import LogTailer, ProcessManager, ServiceStatus
from .update_manager import DesktopUpdateCheck, DesktopUpdateClient

LYRA_VERSION = "0.0.4"

COLORS = {
    "background": "#0f172a",
    "surface": "#182235",
    "surface_soft": "#111a2b",
    "log": "#080e19",
    "border": "#2d3a50",
    "text": "#f5f7fb",
    "text_soft": "#cbd5e1",
    "muted": "#91a1b8",
    "subtle": "#64748b",
    "success": "#22c55e",
    "warning": "#f59e0b",
    "danger": "#ef4444",
    "primary": "#f8fafc",
    "primary_text": "#111827",
}


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
    def __init__(
        self,
        manager: ProcessManager | None = None,
        update_client: DesktopUpdateClient | None = None,
    ) -> None:
        enable_high_dpi()
        super().__init__()
        self.manager = manager or ProcessManager(LauncherPaths.discover())
        self.title(f"Lyra 服务启动器 {self.manager.paths.application_version}")
        self.minsize(720, 560)
        self.geometry(self._centered_geometry(900, 700))
        self._native_icon_handles: list[int] = []
        self._apply_window_icon()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

        self._busy = False
        self._action_messages: queue.Queue[tuple[str, object, bool, bool]] = queue.Queue()
        self._action_buttons: dict[str, tk.Button] = {}
        self._last_statuses: dict[str, ServiceStatus] = {}
        self._update_client = update_client or DesktopUpdateClient(self.manager.paths)
        self._update_messages: queue.Queue[tuple[str, object, bool]] = queue.Queue()
        self._update_result: DesktopUpdateCheck | None = None
        self._update_busy = False
        self._update_window: tk.Toplevel | None = None
        self.auto_open_var = tk.BooleanVar(value=True)
        self._log_tailer = LogTailer(self.manager.paths)
        self._log_tailer.start()

        self._configure_style()
        self._build_interface()
        self._update_button_states(False, False)
        self.after(100, self._drain_queues)
        self.after(250, self._refresh_status)
        self.after(650, lambda: self._check_for_updates(silent=True))

    def _apply_window_icon(self) -> None:
        resource_root = (
            Path(getattr(sys, "_MEIPASS"))
            if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")
            else Path(__file__).resolve().parents[2]
        )
        branding = resource_root / "resources" / "branding"
        png_path = branding / "lyra-app-icon.png"
        ico_path = branding / "lyra-app-icon.ico"
        try:
            self._window_icon = tk.PhotoImage(file=str(png_path))
            self.iconphoto(True, self._window_icon)
        except (OSError, tk.TclError):
            self._window_icon = None
        if sys.platform == "win32":
            try:
                self.iconbitmap(default=str(ico_path))
            except (OSError, tk.TclError):
                pass
            self.after(50, lambda: self._apply_native_window_icon(ico_path))

    def _apply_native_window_icon(self, icon_path: Path) -> None:
        if sys.platform != "win32" or not icon_path.is_file():
            return
        try:
            from ctypes import wintypes

            user32 = ctypes.WinDLL("user32", use_last_error=True)
            user32.GetParent.argtypes = [wintypes.HWND]
            user32.GetParent.restype = wintypes.HWND
            user32.LoadImageW.argtypes = [
                wintypes.HINSTANCE,
                wintypes.LPCWSTR,
                wintypes.UINT,
                ctypes.c_int,
                ctypes.c_int,
                wintypes.UINT,
            ]
            user32.LoadImageW.restype = wintypes.HANDLE
            user32.SendMessageW.argtypes = [
                wintypes.HWND,
                wintypes.UINT,
                wintypes.WPARAM,
                wintypes.LPARAM,
            ]
            user32.SendMessageW.restype = ctypes.c_ssize_t

            self.update_idletasks()
            content_window = self.winfo_id()
            title_window = user32.GetParent(content_window) or content_window
            flags = 0x0010
            handles = [
                (1, user32.LoadImageW(None, str(icon_path), 1, 32, 32, flags)),
                (0, user32.LoadImageW(None, str(icon_path), 1, 16, 16, flags)),
            ]
            for icon_type, handle in handles:
                if handle:
                    user32.SendMessageW(content_window, 0x0080, icon_type, handle)
                    user32.SendMessageW(title_window, 0x0080, icon_type, handle)
                    self._native_icon_handles.append(int(handle))
        except (AttributeError, OSError, tk.TclError):
            pass

    def _configure_style(self) -> None:
        self.configure(background=COLORS["background"])
        style = ttk.Style(self)
        if "clam" in style.theme_names():
            style.theme_use("clam")
        style.configure(
            "Launcher.Vertical.TScrollbar",
            background=COLORS["surface"],
            troughcolor=COLORS["log"],
            bordercolor=COLORS["log"],
            arrowcolor=COLORS["muted"],
        )

    def _build_interface(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(2, weight=1)

        header = tk.Frame(self, background=COLORS["background"])
        header.grid(row=0, column=0, sticky="ew", padx=34, pady=(25, 18))
        header.columnconfigure(1, weight=1)
        brand = tk.Frame(header, background=COLORS["background"])
        brand.grid(row=0, column=0, sticky="w")
        self._header_icon = self._make_header_icon()
        if self._header_icon:
            tk.Label(
                brand,
                image=self._header_icon,
                background=COLORS["background"],
                borderwidth=0,
            ).grid(row=0, column=0, rowspan=2, padx=(0, 12))
        tk.Label(
            brand,
            text="Lyra",
            font=("Microsoft YaHei UI", 26, "bold"),
            foreground="#8794ff",
            background=COLORS["background"],
        ).grid(row=0, column=1, sticky="s")
        self.version_button = tk.Button(
            brand,
            text=f"v{self.manager.paths.application_version}",
            command=self._show_update_window,
            font=("Microsoft YaHei UI", 10),
            foreground=COLORS["muted"],
            background=COLORS["background"],
            activeforeground=COLORS["text"],
            activebackground=COLORS["background"],
            relief="flat",
            borderwidth=0,
            padx=0,
            pady=0,
            cursor="hand2",
        )
        self.version_button.grid(row=1, column=1, sticky="n", pady=(2, 0))
        self.update_notice_label = tk.Label(
            header,
            text="",
            font=("Microsoft YaHei UI", 9),
            foreground=COLORS["warning"],
            background=COLORS["background"],
        )
        self.update_notice_label.grid(row=0, column=1, sticky="e")

        status_card = tk.Frame(
            self,
            background=COLORS["surface"],
            highlightbackground=COLORS["border"],
            highlightthickness=1,
        )
        status_card.grid(row=1, column=0, sticky="ew", padx=72, pady=(0, 18))
        status_card.columnconfigure(1, weight=1)
        self.service_state_label = self._create_status_value(status_card, "未启动", 0)
        self._create_url_row(status_card, 1, "本机访问地址", self.manager.local_url)
        self._create_url_row(
            status_card,
            2,
            "局域网访问地址",
            self.manager.lan_url or "未检测到可用局域网地址",
            enabled=bool(self.manager.lan_url),
        )

        log_section = tk.Frame(self, background=COLORS["background"])
        log_section.grid(row=2, column=0, sticky="nsew", padx=72, pady=(0, 18))
        log_section.columnconfigure(0, weight=1)
        log_section.rowconfigure(1, weight=1)
        log_header = tk.Frame(log_section, background=COLORS["background"])
        log_header.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        log_header.columnconfigure(0, weight=1)
        tk.Label(
            log_header,
            text="运行日志",
            font=("Microsoft YaHei UI", 10),
            foreground=COLORS["muted"],
            background=COLORS["background"],
        ).grid(row=0, column=0, sticky="w")
        clear_logs = tk.Label(
            log_header,
            text="清空日志",
            font=("Microsoft YaHei UI", 9, "underline"),
            foreground=COLORS["subtle"],
            background=COLORS["background"],
            cursor="hand2",
        )
        clear_logs.grid(row=0, column=1, sticky="e")
        clear_logs.bind("<Button-1>", lambda _event: self._clear_log())

        log_frame = tk.Frame(
            log_section,
            background=COLORS["log"],
            highlightbackground=COLORS["border"],
            highlightthickness=1,
        )
        log_frame.grid(row=1, column=0, sticky="nsew")
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        self.log_view = tk.Text(
            log_frame,
            wrap="word",
            state="disabled",
            font=("Cascadia Mono", 9),
            background=COLORS["log"],
            foreground=COLORS["text_soft"],
            insertbackground=COLORS["text_soft"],
            borderwidth=0,
            padx=14,
            pady=12,
        )
        scrollbar = ttk.Scrollbar(
            log_frame,
            orient="vertical",
            command=self.log_view.yview,
            style="Launcher.Vertical.TScrollbar",
        )
        self.log_view.configure(yscrollcommand=scrollbar.set)
        self.log_view.grid(row=0, column=0, sticky="nsew")
        scrollbar.grid(row=0, column=1, sticky="ns")

        self.footer_status = tk.StringVar(value="就绪")
        footer = tk.Frame(
            self,
            background=COLORS["surface_soft"],
            highlightbackground=COLORS["border"],
            highlightthickness=1,
        )
        footer.grid(row=3, column=0, sticky="ew")
        footer.columnconfigure(1, weight=1)
        auto_open = tk.Checkbutton(
            footer,
            text="启动成功后自动打开网页",
            variable=self.auto_open_var,
            selectcolor=COLORS["surface_soft"],
            activebackground=COLORS["surface_soft"],
            activeforeground=COLORS["text_soft"],
            foreground=COLORS["text_soft"],
            background=COLORS["surface_soft"],
            font=("Microsoft YaHei UI", 9),
            borderwidth=0,
            highlightthickness=0,
        )
        auto_open.grid(row=0, column=0, sticky="w", padx=(32, 16), pady=19)
        tk.Label(
            footer,
            textvariable=self.footer_status,
            font=("Microsoft YaHei UI", 9),
            foreground=COLORS["subtle"],
            background=COLORS["surface_soft"],
        ).grid(row=0, column=1, sticky="w")
        actions = tk.Frame(footer, background=COLORS["surface_soft"])
        actions.grid(row=0, column=2, sticky="e", padx=(12, 32), pady=14)
        self._add_action_button(
            actions, "stop", "停止服务", self._stop_services, 0, "danger"
        )
        self._add_action_button(
            actions, "restart", "重启服务", self._restart_services, 1, "secondary"
        )
        self._add_action_button(
            actions, "start", "启动服务", self._start_services, 2, "primary"
        )

    def _make_header_icon(self) -> tk.PhotoImage | None:
        source = getattr(self, "_window_icon", None)
        if source is None:
            return None
        factor = max(1, (max(source.width(), source.height()) + 43) // 44)
        return source.subsample(factor, factor)

    def _show_update_window(self) -> None:
        if self._update_window is not None and self._update_window.winfo_exists():
            self._update_window.deiconify()
            self._update_window.lift()
            self._update_window.focus_force()
            return

        window = tk.Toplevel(self)
        self._update_window = window
        window.title("Lyra 更新")
        window.minsize(460, 330)
        window.geometry(self._centered_child_geometry(540, 400))
        window.configure(background=COLORS["background"])
        window.transient(self)
        window.columnconfigure(0, weight=1)
        window.rowconfigure(1, weight=1)
        window.protocol("WM_DELETE_WINDOW", self._close_update_window)

        heading = tk.Frame(window, background=COLORS["surface"])
        heading.grid(row=0, column=0, sticky="ew")
        heading.columnconfigure(0, weight=1)
        tk.Label(
            heading,
            text="应用更新",
            font=("Microsoft YaHei UI", 13, "bold"),
            foreground=COLORS["text"],
            background=COLORS["surface"],
        ).grid(row=0, column=0, sticky="w", padx=20, pady=(16, 3))
        self.update_dialog_version = tk.Label(
            heading,
            text=f"当前版本 v{self.manager.paths.application_version}",
            font=("Microsoft YaHei UI", 9),
            foreground=COLORS["muted"],
            background=COLORS["surface"],
        )
        self.update_dialog_version.grid(row=1, column=0, sticky="w", padx=20, pady=(0, 16))

        content = tk.Frame(window, background=COLORS["background"])
        content.grid(row=1, column=0, sticky="nsew", padx=20, pady=16)
        content.columnconfigure(0, weight=1)
        content.rowconfigure(2, weight=1)
        self.update_dialog_title = tk.Label(
            content,
            text="尚未检查更新",
            font=("Microsoft YaHei UI", 12, "bold"),
            foreground=COLORS["text"],
            background=COLORS["background"],
        )
        self.update_dialog_title.grid(row=0, column=0, sticky="w")
        self.update_dialog_message = tk.Label(
            content,
            text="点击“检查更新”获取最新版本。",
            justify="left",
            anchor="w",
            font=("Microsoft YaHei UI", 9),
            foreground=COLORS["muted"],
            background=COLORS["background"],
        )
        self.update_dialog_message.grid(row=1, column=0, sticky="ew", pady=(4, 10))
        self.update_notes = tk.Text(
            content,
            wrap="word",
            state="disabled",
            height=7,
            font=("Microsoft YaHei UI", 9),
            foreground=COLORS["text_soft"],
            background=COLORS["surface_soft"],
            borderwidth=0,
            padx=12,
            pady=10,
        )
        self.update_notes.grid(row=2, column=0, sticky="nsew")

        actions = tk.Frame(window, background=COLORS["surface_soft"])
        actions.grid(row=2, column=0, sticky="ew")
        actions.columnconfigure(0, weight=1)
        self.update_check_button = tk.Button(
            actions,
            text="检查更新",
            command=lambda: self._check_for_updates(silent=False),
            font=("Microsoft YaHei UI", 9),
            foreground=COLORS["text_soft"],
            background=COLORS["surface"],
            activeforeground=COLORS["text"],
            activebackground=COLORS["border"],
            relief="flat",
            padx=16,
            pady=9,
            cursor="hand2",
        )
        self.update_check_button.grid(row=0, column=1, padx=(10, 8), pady=12)
        self.update_install_button = tk.Button(
            actions,
            text="一键升级",
            command=self._install_available_update,
            font=("Microsoft YaHei UI", 9, "bold"),
            foreground=COLORS["primary_text"],
            background=COLORS["primary"],
            activeforeground=COLORS["primary_text"],
            activebackground="#e2e8f0",
            disabledforeground=COLORS["subtle"],
            relief="flat",
            padx=18,
            pady=9,
            cursor="arrow",
            state="disabled",
        )
        self.update_install_button.grid(row=0, column=2, padx=(0, 20), pady=12)
        self._render_update_result()
        if self._update_result is None and not self._update_busy:
            self._check_for_updates(silent=False)

    def _close_update_window(self) -> None:
        if self._update_window is not None:
            self._update_window.destroy()
        self._update_window = None

    def _check_for_updates(self, silent: bool) -> None:
        if self._update_busy:
            return
        self._update_busy = True
        self.update_notice_label.configure(text="正在检查更新…", foreground=COLORS["muted"])
        self._render_update_result()

        def execute() -> None:
            try:
                self._update_messages.put(("success", self._update_client.check(), silent))
            except Exception as error:
                self._update_messages.put(("error", error, silent))

        threading.Thread(target=execute, name="lyra-update-check", daemon=True).start()

    def _install_available_update(self) -> None:
        candidate = self._update_result.candidate if self._update_result else None
        if candidate is None or self._update_busy:
            return
        notes = "\n".join(f"• {note}" for note in candidate.release_notes)
        prompt = f"将 Lyra 升级到 v{candidate.version}。\n\n升级时会自动停止并重启服务。"
        if notes:
            prompt += f"\n\n更新说明：\n{notes}"
        if not messagebox.askyesno("确认升级", prompt, parent=self._update_window or self):
            return
        self._update_busy = True
        self.footer_status.set("正在启动更新程序…")
        self._set_buttons_enabled(False)
        self._render_update_result()
        try:
            self._update_client.start_update(candidate, self.manager.port)
        except Exception as error:
            self._update_busy = False
            self.footer_status.set("升级启动失败")
            self._set_buttons_enabled(True)
            self._render_update_result()
            messagebox.showerror("升级启动失败", str(error), parent=self._update_window or self)
            return
        self._append_launcher_log(f"已提交 v{candidate.version} 升级任务，启动器将自动重新打开。")
        self.after(180, self._destroy_launcher)

    def _drain_update_messages(self) -> None:
        try:
            while True:
                kind, value, silent = self._update_messages.get_nowait()
                self._update_busy = False
                if kind == "success" and isinstance(value, DesktopUpdateCheck):
                    self._update_result = value
                    if value.update_available:
                        self.update_notice_label.configure(
                            text=f"发现新版本 v{value.latest_version}",
                            foreground=COLORS["warning"],
                        )
                        self.version_button.configure(foreground=COLORS["warning"])
                    elif value.enabled:
                        self.update_notice_label.configure(
                            text="已是最新版本",
                            foreground=COLORS["success"],
                        )
                    else:
                        self.update_notice_label.configure(
                            text="未配置更新服务",
                            foreground=COLORS["subtle"],
                        )
                else:
                    self.update_notice_label.configure(
                        text="更新检查失败",
                        foreground=COLORS["danger"],
                    )
                    if not silent:
                        messagebox.showerror("检查更新失败", str(value), parent=self._update_window or self)
                self._render_update_result()
        except queue.Empty:
            pass

    def _render_update_result(self) -> None:
        if self._update_window is None or not self._update_window.winfo_exists():
            return
        if self._update_busy:
            self.update_dialog_title.configure(text="正在检查更新")
            self.update_dialog_message.configure(text="正在连接更新服务器，请稍候。")
        elif self._update_result is None:
            self.update_dialog_title.configure(text="尚未检查更新")
            self.update_dialog_message.configure(text="点击“检查更新”获取最新版本。")
        elif self._update_result.update_available:
            self.update_dialog_title.configure(text=f"发现新版本 v{self._update_result.latest_version}")
            self.update_dialog_message.configure(
                text=f"安装包大小：{_format_bytes(self._update_result.artifact_size or 0)}"
            )
        elif self._update_result.enabled:
            self.update_dialog_title.configure(text="已是最新版本")
            self.update_dialog_message.configure(text="当前没有可用更新。")
        else:
            self.update_dialog_title.configure(text="自动更新未配置")
            self.update_dialog_message.configure(text="当前发布包没有配置更新清单地址。")

        notes = self._update_result.release_notes if self._update_result else ()
        self.update_notes.configure(state="normal")
        self.update_notes.delete("1.0", "end")
        self.update_notes.insert(
            "1.0",
            "\n".join(f"• {note}" for note in notes) if notes else "暂无更新说明。",
        )
        self.update_notes.configure(state="disabled")
        can_install = bool(
            self._update_result
            and self._update_result.candidate
            and not self._update_busy
        )
        self.update_check_button.configure(
            state="disabled" if self._update_busy else "normal",
            cursor="arrow" if self._update_busy else "hand2",
        )
        self.update_install_button.configure(
            state="normal" if can_install else "disabled",
            cursor="hand2" if can_install else "arrow",
        )

    def _create_status_value(self, parent: tk.Frame, text: str, row: int) -> tk.Label:
        tk.Label(
            parent,
            text="服务状态",
            font=("Microsoft YaHei UI", 10),
            foreground=COLORS["muted"],
            background=COLORS["surface"],
        ).grid(row=row, column=0, sticky="w", padx=(22, 12), pady=15)
        label = tk.Label(
            parent,
            text=text,
            font=("Microsoft YaHei UI", 10, "bold"),
            foreground=COLORS["danger"],
            background=COLORS["surface"],
        )
        label.grid(row=row, column=1, sticky="e", padx=(12, 0), pady=15)
        return label

    def _create_url_row(
        self,
        parent: tk.Frame,
        row: int,
        title: str,
        url: str,
        enabled: bool = True,
    ) -> None:
        tk.Frame(parent, height=1, background=COLORS["border"]).grid(
            row=row,
            column=0,
            columnspan=2,
            sticky="new",
        )
        tk.Label(
            parent,
            text=title,
            font=("Microsoft YaHei UI", 10),
            foreground=COLORS["muted"],
            background=COLORS["surface"],
        ).grid(row=row, column=0, sticky="w", padx=(22, 12), pady=15)
        value = tk.Label(
            parent,
            text=url,
            font=("Microsoft YaHei UI", 10, "underline" if enabled else "normal"),
            foreground=COLORS["text"] if enabled else COLORS["subtle"],
            background=COLORS["surface"],
            cursor="hand2" if enabled else "arrow",
        )
        value.grid(row=row, column=1, sticky="e", padx=(12, 22), pady=15)
        if enabled:
            value.bind("<Button-1>", lambda _event: webbrowser.open(url))

    def _add_action_button(
        self,
        parent: tk.Frame,
        name: str,
        text: str,
        command: Callable[[], None],
        column: int,
        appearance: str,
    ) -> None:
        colors = {
            "primary": (COLORS["primary"], COLORS["primary_text"], "#e2e8f0"),
            "danger": ("#9f2f3b", COLORS["text"], "#b83a48"),
            "secondary": (COLORS["surface"], COLORS["text_soft"], COLORS["border"]),
        }
        background, foreground, active = colors[appearance]
        button = tk.Button(
            parent,
            text=text,
            command=command,
            font=("Microsoft YaHei UI", 9, "bold"),
            foreground=foreground,
            disabledforeground=COLORS["subtle"],
            background=background,
            activeforeground=foreground,
            activebackground=active,
            relief="flat",
            borderwidth=0,
            padx=18,
            pady=10,
            cursor="hand2",
        )
        button.grid(row=0, column=column, padx=(0 if column == 0 else 8, 0))
        self._action_buttons[name] = button

    def _start_services(self) -> None:
        self._append_launcher_log("正在启动 API 与 Worker 服务…")
        self._run_action(
            "正在启动服务…",
            self.manager.start_services,
            open_after=self.auto_open_var.get(),
        )

    def _stop_services(self) -> None:
        self._append_launcher_log("正在停止服务…")
        self._run_action("正在停止服务…", self.manager.stop_services)

    def _restart_services(self) -> None:
        self._append_launcher_log("正在重启服务并应用最新监听设置…")
        self._run_action(
            "正在重启服务…",
            self.manager.restart_services,
            open_after=self.auto_open_var.get(),
        )

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
        self._drain_update_messages()
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
                    self._append_launcher_log(f"操作失败：{value}")
                    messagebox.showerror("操作失败", str(value), parent=self)
                else:
                    self.footer_status.set("就绪")
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
        self._last_statuses = statuses
        api = statuses.get("api")
        worker = statuses.get("worker")
        api_running = bool(api and api.running)
        worker_running = bool(worker and worker.running)
        if api_running and worker_running:
            state_text = "运行中"
            state_color = COLORS["success"]
        elif api_running or worker_running:
            state_text = "部分运行"
            state_color = COLORS["warning"]
        else:
            state_text = "未启动"
            state_color = COLORS["danger"]
        self.service_state_label.configure(text=state_text, foreground=state_color)
        self._update_button_states(api_running, worker_running)

    def _append_log(self, message: str) -> None:
        self.log_view.configure(state="normal")
        self.log_view.insert("end", message + "\n")
        line_count = int(self.log_view.index("end-1c").split(".", 1)[0])
        if line_count > 5000:
            self.log_view.delete("1.0", f"{line_count - 4500}.0")
        self.log_view.see("end")
        self.log_view.configure(state="disabled")

    def _append_launcher_log(self, message: str) -> None:
        self._append_log(f"[{time.strftime('%H:%M:%S')}] [LAUNCHER] {message}")

    def _set_buttons_enabled(self, enabled: bool) -> None:
        if not enabled:
            for button in self._action_buttons.values():
                button.configure(state="disabled", cursor="arrow")
            return
        api_running = bool(
            self._last_statuses.get("api") and self._last_statuses["api"].running
        )
        worker_running = bool(
            self._last_statuses.get("worker") and self._last_statuses["worker"].running
        )
        self._update_button_states(api_running, worker_running)

    def _update_button_states(self, api_running: bool, worker_running: bool) -> None:
        if not self._action_buttons or self._busy:
            return
        states = {
            "start": not (api_running and worker_running),
            "stop": api_running or worker_running,
            "restart": api_running or worker_running,
        }
        for name, button in self._action_buttons.items():
            enabled = states[name]
            button.configure(
                state="normal" if enabled else "disabled",
                cursor="hand2" if enabled else "arrow",
            )

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

    def _centered_child_geometry(self, width: int, height: int) -> str:
        self.update_idletasks()
        x = self.winfo_rootx() + max(0, (self.winfo_width() - width) // 2)
        y = self.winfo_rooty() + max(0, (self.winfo_height() - height) // 2)
        return f"{width}x{height}+{x}+{y}"

    def _centered_geometry(self, width: int, height: int) -> str:
        screen_width = self.winfo_screenwidth()
        screen_height = self.winfo_screenheight()
        x = max(0, (screen_width - width) // 2)
        y = max(0, (screen_height - height) // 2)
        return f"{width}x{height}+{x}+{y}"


def _format_bytes(value: int) -> str:
    if value < 1024 * 1024:
        return f"{max(1, (value + 1023) // 1024)} KB"
    return f"{value / 1024 / 1024:.1f} MB"
