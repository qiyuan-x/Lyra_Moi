import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

/** Opens an asset directory using the operating system's directory handler. */
export async function revealLocalDirectory(directoryPath: string): Promise<void> {
  const target = resolve(directoryPath);
  const info = await stat(target);
  if (!info.isDirectory()) throw new Error("Asset storage path is not a directory.");

  if (process.platform === "win32") {
    await openWindowsDirectory(target);
    return;
  }
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  await new Promise<void>((resolveSpawn, rejectSpawn) => {
    const child = spawn(command, [target], { detached: true, stdio: "ignore" });
    child.once("error", rejectSpawn);
    child.once("spawn", () => {
      child.unref();
      resolveSpawn();
    });
  });
}

async function openWindowsDirectory(target: string): Promise<void> {
  const powershell = resolve(
    process.env.SystemRoot || "C:\\Windows",
    "System32", "WindowsPowerShell", "v1.0", "powershell.exe"
  );
  // Hide only the helper console. ShellExecute must show the directory window normally.
  const script = "$ErrorActionPreference = 'Stop'; Start-Process -FilePath $env:LYRA_OPEN_DIRECTORY -WindowStyle Normal";
  await new Promise<void>((resolveOpen, rejectOpen) => {
    const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, LYRA_OPEN_DIRECTORY: target },
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 10_000
    });
    let detail = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      detail = (detail + chunk.toString("utf8")).slice(0, 8_192);
    });
    child.once("error", (error) => rejectOpen(new Error(`打开文件目录失败：${error.message}`)));
    child.once("close", (code) => {
      if (code === 0) resolveOpen();
      else rejectOpen(new Error(`打开文件目录失败：${detail.trim() || "系统未能打开目录，请检查桌面会话或权限。"}`));
    });
  });
}
