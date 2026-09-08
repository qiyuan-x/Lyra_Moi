from __future__ import annotations

import json
import queue
import threading
import tkinter as tk
from tkinter import ttk
from pathlib import Path
from collections.abc import Callable

from .paths import LauncherPaths
from .update_manager import DesktopUpdateInstaller


def run_update_window(paths: LauncherPaths, request: Path, restart: Callable[[], None]) -> int:
    window = tk.Tk()
    window.title("Lyra 更新")
    window.configure(bg="#192334")
    window.minsize(460, 240)
    window.geometry(f"520x280+{max(0, (window.winfo_screenwidth()-520)//2)}+{max(0, (window.winfo_screenheight()-280)//2)}")
    status = tk.StringVar(value="正在准备更新…")
    tk.Label(window, text="应用更新", bg="#192334", fg="#f0f3f8", font=("Microsoft YaHei UI", 16, "bold")).pack(anchor="w", padx=24, pady=(22, 12))
    label = tk.Label(window, textvariable=status, bg="#192334", fg="#c2cddd", wraplength=460, justify="left")
    label.pack(fill="x", padx=24)
    bar = ttk.Progressbar(window, maximum=100, mode="indeterminate")
    bar.pack(fill="x", padx=24, pady=20)
    bar.start(15)
    result: queue.Queue[Exception | None] = queue.Queue()
    finished = False
    code = 1

    def close() -> None:
        if finished:
            window.destroy()

    window.protocol("WM_DELETE_WINDOW", close)
    buttons = tk.Frame(window, bg="#192334")
    buttons.pack(fill="x", padx=24, pady=10)
    close_button = ttk.Button(buttons, text="关闭", command=close, state="disabled")
    close_button.pack(side="right")

    def execute() -> None:
        try:
            DesktopUpdateInstaller(paths).apply(request)
            result.put(None)
        except Exception as error:
            result.put(error)

    def poll() -> None:
        nonlocal finished, code
        try:
            snapshot = json.loads(paths.update_state_file.read_text(encoding="utf-8"))["snapshot"]
            progress = snapshot.get("progress")
            status.set(snapshot.get("message", "正在更新…") + (f" {progress}%" if progress is not None else ""))
            if progress is not None:
                bar.stop()
                bar.configure(mode="determinate", value=progress)
            elif str(bar.cget("mode")) != "indeterminate":
                bar.configure(mode="indeterminate")
                bar.start(15)
        except (OSError, ValueError, KeyError, TypeError):
            pass
        try:
            error = result.get_nowait()
        except queue.Empty:
            window.after(200, poll)
            return
        finished = True
        bar.stop()
        close_button.configure(state="normal")
        if error is not None:
            status.set(f"更新失败：{error}\n详细记录：{paths.update_state_file}")
        else:
            code = 0
            try:
                restart()
                status.set("更新完成，服务已就绪，已请求打开启动器。")
            except Exception as failure:
                status.set(f"更新已完成，但启动器打开失败：{failure}")
        ttk.Button(buttons, text="重新打开启动器", command=restart).pack(side="left")

    ready = paths.data_dir / "temp" / "updater" / "window-ready"
    def start() -> None:
        ready.parent.mkdir(parents=True, exist_ok=True)
        ready.write_text("ready", encoding="utf-8")
        threading.Thread(target=execute, daemon=True).start()
    window.after(100, start)
    window.after(200, poll)
    window.mainloop()
    return code
