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
  inline?: boolean;
}

export function ApplicationUpdateControl({ api, collapsed, inline = false }: ApplicationUpdateControlProps) {
  const [snapshot, setSnapshot] = useState<ApplicationUpdateSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<import("@lyra/contracts").ApplicationUpdateManifest[]>([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [error, setError] = useState("");
  const loadVersions = async () => {
    setBusy(true); setError("");
    try { setVersions((await api.getApplicationVersions()).versions); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const install = async () => {
    if (!selectedVersion || !window.confirm(`安装 v${selectedVersion}？服务会停止并重启。当前数据会备份，安装失败将恢复原版本。`)) return;
    setBusy(true); setError("");
    try { setSnapshot(await api.installApplicationVersion(selectedVersion)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally {
      setBusy(false);
    }
  };

  const version = snapshot?.currentVersion ?? "0.0.3";
  const active = Boolean(snapshot && ACTIVE_STATUSES.has(snapshot.status));
  return (
    <div className={`application-update-control${collapsed ? " collapsed" : ""}${inline ? " application-update-inline" : ""}`} ref={rootRef}>
      {!inline && <button
        type="button"
        className={`application-version-button${snapshot?.updateAvailable ? " update-available" : ""}`}
        title={`当前版本 v${version}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        v{version}
        {snapshot?.updateAvailable && <span aria-label="有新版本" />}
      </button>}
      {(open || inline) && !collapsed && (
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
          <p className="application-update-status">{snapshot?.message ?? "正在读取版本信息。"}</p>
          {error && <p role="alert">{error}</p>}
          <details className="application-update-history" onToggle={(event) => { if (event.currentTarget.open && versions.length === 0) void loadVersions(); }}>
            <summary>版本回退</summary>
            <div className="application-update-history-body">
            <span>选择要回退到的版本（近 3 个版本）</span>
            <div className="application-update-version-list">
              {versions.filter((item) => item.version !== version).map((item) => <button type="button" key={item.version} className={selectedVersion === item.version ? "selected" : ""} disabled={busy || active} onClick={() => setSelectedVersion(item.version)}><strong>v{item.version}</strong><small>{formatPublishedDate(item.publishedAt)}</small></button>)}
            </div>
            {versions.filter((item) => item.version === selectedVersion && item.version !== version).map((item) => <div key={item.version}>
              <p>{formatBytes(item.artifacts["windows-x64"].size)}</p>
              <ul>{item.releaseNotes.map((note, index) => <li key={index}>{note}</li>)}</ul>
              <button type="button" disabled={busy || active} onClick={() => void install()}>下载并安装此版本</button>
            </div>)}
            </div>
          </details>
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

function formatPublishedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
