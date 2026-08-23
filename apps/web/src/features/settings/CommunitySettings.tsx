import { useEffect, useState, type FormEvent } from "react";
import type { ApiClient } from "../../lib/api-client.js";

interface CommunitySettingsProps {
  api: ApiClient;
  onError: (error: unknown) => void;
  onChanged: (url: string) => void;
}

type SaveState = "loading" | "ready" | "saving" | "saved" | "error";

export function CommunitySettings(props: CommunitySettingsProps) {
  const [url, setUrl] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const error = validateUrl(url);

  useEffect(() => {
    let active = true;
    void props.api.getCommunitySettings()
      .then((snapshot) => {
        if (!active) return;
        setUrl(snapshot.settings.url);
        setSaveState("ready");
      })
      .catch((loadError) => {
        if (!active) return;
        setSaveState("error");
        props.onError(loadError);
      });
    return () => {
      active = false;
    };
  }, [props.api, props.onError]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (error) return;
    setSaveState("saving");
    try {
      const snapshot = await props.api.updateCommunitySettings({ url });
      setUrl(snapshot.settings.url);
      props.onChanged(snapshot.settings.url);
      setSaveState("saved");
    } catch (saveError) {
      setSaveState("error");
      props.onError(saveError);
    }
  }

  function openWebsite() {
    if (error || !url.trim()) return;
    window.open(url.trim(), "_blank", "noopener,noreferrer");
  }

  return (
    <section className="community-settings">
      <header className="settings-overview-heading">
        <div>
          <h2>社区设置</h2>
          <p>配置“其他功能”中的社区入口。社区网页默认在 Lyra 内显示。</p>
        </div>
      </header>
      <section className="settings-detail-section community-settings-section">
        <header>
          <div>
            <strong>社区入口</strong>
            <span>网址保存在 Lyra 本地，不保存社区账号或社区数据。</span>
          </div>
          <span className={`community-save-state state-${saveState}`}>
            {saveStateLabel(saveState)}
          </span>
        </header>
        <form className="community-settings-form" onSubmit={(event) => void save(event)}>
          <label className="field">
            <span>社区网址</span>
            <input
              type="url"
              inputMode="url"
              placeholder="https://example.com/community/"
              value={url}
              disabled={saveState === "loading"}
              aria-invalid={Boolean(error)}
              onChange={(event) => {
                setUrl(event.target.value);
                setSaveState("ready");
              }}
            />
            <small className={error ? "field-error" : ""}>
              {error ?? "仅支持 http:// 或 https://，留空表示不启用社区入口。"}
            </small>
          </label>
          <div>
            <button
              type="button"
              className="button button-secondary"
              disabled={Boolean(error) || !url.trim() || saveState === "loading"}
              title="在新窗口打开"
              onClick={openWebsite}
            >
              打开网页
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={Boolean(error) || saveState === "loading" || saveState === "saving"}
            >
              {saveState === "saving" ? "正在保存" : "保存"}
            </button>
          </div>
        </form>
      </section>
    </section>
  );
}

function validateUrl(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:"
      ? null
      : "社区网址只支持 http:// 或 https://。";
  } catch {
    return "社区网址格式无效。";
  }
}

function saveStateLabel(value: SaveState): string {
  if (value === "loading") return "正在加载";
  if (value === "saving") return "正在保存";
  if (value === "saved") return "已保存";
  if (value === "error") return "保存失败";
  return "";
}
