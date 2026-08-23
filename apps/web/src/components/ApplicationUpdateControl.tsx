import type { ApplicationUpdateSnapshot } from "@lyra/contracts";
import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../lib/api-client.js";
import { Icon } from "./Icon.js";

const ACTIVE_STATUSES = new Set([
  "scheduled",
  "downloading",
  "verifying",
  "installing",
  "restarting",
  "rolling_back"
]);

interface ApplicationUpdateControlProps {
  api: ApiClient;
  collapsed: boolean;
}

export function ApplicationUpdateControl({ api, collapsed }: ApplicationUpdateControlProps) {
  const [snapshot, setSnapshot] = useState<ApplicationUpdateSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void api.getApplicationUpdate()
      .then(async (value) => {
        if (cancelled) return;
        setSnapshot(value);
        if (
          value.enabled &&
          value.status !== "available" &&
          !ACTIVE_STATUSES.has(value.status)
        ) {
          const checked = await api.checkApplicationUpdate();
          if (!cancelled) setSnapshot(checked);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (!snapshot || !ACTIVE_STATUSES.has(snapshot.status)) return;
    const timer = window.setInterval(() => {
      void api.getApplicationUpdate()
        .then((value) => {
          setSnapshot(value);
        })
        .catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [api, snapshot?.status]);

  const check = async () => {
    setBusy(true);
    try {
      setSnapshot(await api.checkApplicationUpdate());
    } finally {
      setBusy(false);
    }
  };

  const version = snapshot?.currentVersion ?? "0.0.3";
  const active = Boolean(snapshot && ACTIVE_STATUSES.has(snapshot.status));
  return (
    <div className={`application-update-control${collapsed ? " collapsed" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`application-version-button${snapshot?.updateAvailable ? " update-available" : ""}`}
        title={`当前版本 v${version}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        v{version}
        {snapshot?.updateAvailable && <span aria-label="有新版本" />}
      </button>
      {open && !collapsed && (
        <div className="application-update-popover">
          <header>
            <span>当前版本</span>
            <button
              type="button"
              aria-label="检查更新"
              title="检查更新"
              disabled={busy || active || !snapshot?.enabled}
              onClick={() => void check()}
            >
              <Icon name="retry" size={17} />
            </button>
          </header>
          <div className="application-update-version">
            <strong>v{version}</strong>
            {snapshot?.status === "current" || snapshot?.status === "completed" ? (
              <span className="application-update-ok"><Icon name="confirm" size={14} /></span>
            ) : null}
          </div>
          <p>{snapshot?.message ?? "正在读取版本信息。"}</p>
          {snapshot?.latestVersion && snapshot.updateAvailable && (
            <div className="application-update-release">
              <strong>新版本 v{snapshot.latestVersion}</strong>
              {snapshot.artifactSize && <span>{formatBytes(snapshot.artifactSize)}</span>}
              {snapshot.releaseNotes.length > 0 && (
                <ul>{snapshot.releaseNotes.map((note) => <li key={note}>{note}</li>)}</ul>
              )}
            </div>
          )}
          {snapshot?.progress !== null && active && (
            <div className="application-update-progress">
              <span style={{ width: `${snapshot?.progress ?? 0}%` }} />
            </div>
          )}
          {snapshot?.status === "available" && (
            <div className="application-update-launcher-hint">
              请在 Windows 启动器中点击版本号完成一键升级。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
