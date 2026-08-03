import { access, rm } from "node:fs/promises";
import { resolve } from "node:path";

export interface ProcessStopFileWatcher {
  close(): void;
}

export async function clearProcessStopFile(filePath: string | undefined): Promise<void> {
  if (!filePath?.trim()) return;
  await rm(resolve(filePath), { force: true });
}

export function watchProcessStopFile(
  filePath: string | undefined,
  onStop: () => void | Promise<void>,
  intervalMs = 250
): ProcessStopFileWatcher {
  if (!filePath?.trim()) return { close() {} };
  if (!Number.isInteger(intervalMs) || intervalMs < 50 || intervalMs > 60_000) {
    throw new Error("Stop-file interval must be between 50 and 60000 milliseconds.");
  }

  const target = resolve(filePath);
  let closed = false;
  let checking = false;
  const timer = setInterval(() => {
    if (closed || checking) return;
    checking = true;
    void access(target)
      .then(async () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        await onStop();
      })
      .catch(() => undefined)
      .finally(() => {
        checking = false;
      });
  }, intervalMs);
  timer.unref();

  return {
    close() {
      closed = true;
      clearInterval(timer);
    }
  };
}
