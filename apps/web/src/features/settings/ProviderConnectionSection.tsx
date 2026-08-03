import { useEffect, useRef, useState } from "react";
import type {
  ProviderAdapterType,
  ProviderConnectionTestResult,
  ProviderProfileSnapshot,
  ProviderProtocol,
  ProviderServiceType
} from "@lyra/contracts";
import {
  adapterLabel,
  protocolLabels,
  type ProviderPreset
} from "./provider-presets.js";

const INTERNAL_SETTINGS_KEY = "__lyra";

export interface ProviderFormValue {
  name: string;
  protocol: ProviderProtocol;
  adapterType: ProviderAdapterType;
  baseUrl: string;
  settings: Record<string, unknown>;
  apiKey: string;
  clearApiKey: boolean;
  secondaryApiKey: string;
  clearSecondaryApiKey: boolean;
  enabled: boolean;
}

export interface ConnectionStatus {
  type: "saved" | "saving" | "testing" | "success" | "error";
  text: string;
}

interface ProviderConnectionSectionProps {
  profile: ProviderProfileSnapshot | null;
  preset: ProviderPreset | null;
  serviceType: ProviderServiceType;
  busy: boolean;
  feedback: ConnectionStatus | null;
  onSave: (value: ProviderFormValue) => Promise<ProviderProfileSnapshot>;
  onTest: (value: ProviderFormValue) => Promise<ProviderConnectionTestResult>;
}

export function ProviderConnectionSection(
  props: ProviderConnectionSectionProps
) {
  const initialProtocol =
    props.preset?.protocol ??
    props.profile?.protocol ??
    "openai-compatible";
  const [name, setName] = useState(
    props.profile?.name ??
    props.preset?.name ??
    ""
  );
  const [protocol, setProtocol] = useState<ProviderProtocol>(initialProtocol);
  const adapterType =
    props.preset?.adapterType ??
    (props.serviceType === "model"
      ? props.profile?.adapterType ?? protocol
      : protocol);
  const initialBaseUrl =
    adapterType === "hunyuan" &&
    props.profile?.baseUrl.includes("ai3d.tencentcloudapi.com")
      ? props.preset?.baseUrl ?? "https://api.ai3d.cloud.tencent.com"
      : props.profile?.baseUrl ?? props.preset?.baseUrl ?? "";
  const initialGuide = readApiKeyGuide(
    props.profile?.settings ?? props.preset?.settings ?? {},
    props.preset
  );
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [enabled, setEnabled] = useState(props.profile?.enabled ?? true);
  const [apiKeyWebsite, setApiKeyWebsite] = useState(initialGuide.website);
  const [apiKeyGuide, setApiKeyGuide] = useState(initialGuide.steps);
  const [status, setStatus] = useState<ConnectionStatus | null>(props.feedback);
  const lastPersisted = useRef(
    connectionSignature({
      name: props.profile?.name ?? props.preset?.name ?? "",
      protocol: initialProtocol,
      adapterType,
      baseUrl: props.profile?.baseUrl ?? props.preset?.baseUrl ?? "",
      settings: withApiKeyGuide(
        props.profile?.settings ?? props.preset?.settings ?? {},
        initialGuide.website,
        initialGuide.steps
      ),
      apiKey: "",
      clearApiKey: false,
      secondaryApiKey: "",
      clearSecondaryApiKey: false,
      enabled: props.profile?.enabled ?? true
    })
  );
  const requiresApiKey =
    protocol !== "openai-compatible" ||
    props.preset?.id === "deepseek" ||
    props.serviceType === "model";
  const keepsExistingKey = Boolean(props.profile?.hasApiKey && !clearApiKey);
  const missingRequiredKey =
    enabled &&
    requiresApiKey &&
    !keepsExistingKey &&
    !apiKey.trim();

  useEffect(() => {
    if (props.feedback) setStatus(props.feedback);
  }, [props.feedback]);

  useEffect(() => {
    if (status?.type !== "saved" && status?.type !== "success") return;
    const timer = window.setTimeout(() => setStatus(null), 3_000);
    return () => window.clearTimeout(timer);
  }, [status]);

  function currentValue(): ProviderFormValue {
    const settings = withApiKeyGuide(
      props.profile?.settings ?? props.preset?.settings ?? {},
      apiKeyWebsite,
      apiKeyGuide
    );
    return {
      name: name.trim(),
      protocol: props.preset?.protocol ?? protocol,
      adapterType,
      baseUrl: baseUrl.trim(),
      settings,
      apiKey: apiKey.trim(),
      clearApiKey,
      secondaryApiKey: "",
      clearSecondaryApiKey: false,
      enabled
    };
  }

  function markSaved(
    value: ProviderFormValue,
    profile?: ProviderProfileSnapshot
  ) {
    const savedValue = profile
      ? {
          ...value,
          name: profile.name,
          protocol: profile.protocol,
          adapterType: profile.adapterType,
          baseUrl: profile.baseUrl,
          settings: profile.settings,
          enabled: profile.enabled
        }
      : value;
    lastPersisted.current = connectionSignature(savedValue);
    if (profile) {
      setName(profile.name);
      setProtocol(profile.protocol);
      setBaseUrl(profile.baseUrl);
      setEnabled(profile.enabled);
    }
    if (value.apiKey) {
      setApiKey((current) => current.trim() === value.apiKey ? "" : current);
    }
    if (value.clearApiKey) setClearApiKey(false);
  }

  useEffect(() => {
    const value = currentValue();
    const connectionChanged =
      connectionSignature(value) !== lastPersisted.current;
    const secretChanged = Boolean(value.apiKey) || value.clearApiKey;
    if (!connectionChanged && !secretChanged) return;
    if (
      !value.name ||
      !value.baseUrl ||
      missingRequiredKey ||
      props.busy
    ) return;
    setStatus({ type: "saving", text: "正在自动保存…" });
    const timer = window.setTimeout(() => {
      void props.onSave(value)
        .then((profile) => {
          markSaved(value, profile);
          setStatus({ type: "saved", text: "修改已自动保存" });
        })
        .catch((error: unknown) => {
          setStatus({ type: "error", text: toErrorMessage(error) });
        });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [
    apiKey,
    baseUrl,
    clearApiKey,
    enabled,
    missingRequiredKey,
    name,
    apiKeyGuide,
    apiKeyWebsite,
    props.busy,
    protocol
  ]);

  async function test() {
    const value = currentValue();
    if (
      !value.name ||
      !value.baseUrl ||
      missingRequiredKey ||
      props.busy
    ) return;
    setStatus({
      type: "testing",
      text: "正在保存最新配置并读取模型…"
    });
    try {
      const result = await props.onTest(value);
      markSaved(value);
      setStatus({
        type: "success",
        text: `连接成功，已同步 ${result.modelCount} 个可用模型，耗时 ${result.elapsedMs} ms`
      });
    } catch (error) {
      setStatus({ type: "error", text: toErrorMessage(error) });
    }
  }

  return (
    <section className="settings-detail-section settings-connection-section">
      <header>
        <div>
          <strong>连接信息</strong>
          <span>修改后自动保存，API Key 仅写入 data/config/.env</span>
        </div>
        <label className="settings-enable-control">
          <span>是否启用</span>
          <span className="switch">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span />
          </span>
        </label>
      </header>
      <div className="settings-connection-editor">
        <label className="field">
          <span>配置名称</span>
          <input
            value={name}
            disabled={Boolean(props.preset)}
            onChange={(event) => setName(event.target.value)}
            autoFocus={!props.profile && !props.preset}
          />
        </label>
        <label className="field">
          <span>接口格式</span>
          {props.preset ? (
            <select value={adapterType} disabled>
              <option value={adapterType}>{adapterLabel(adapterType)}</option>
            </select>
          ) : (
            <select
              value={protocol}
              onChange={(event) =>
                setProtocol(event.target.value as ProviderProtocol)}
            >
              {Object.entries(protocolLabels).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          )}
        </label>
        <label className="field settings-grid-wide">
          <span>基础 URL</span>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </label>
        <div className="field settings-api-key-field settings-grid-wide">
          <span id="provider-api-key-label">
            API 密钥{requiresApiKey ? "（必填）" : "（可选）"}
          </span>
          <div className="settings-api-key-control">
            <input
              aria-labelledby="provider-api-key-label"
              type="password"
              value={apiKey}
              disabled={clearApiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                props.profile?.hasApiKey
                  ? "已保存，输入新值可替换"
                  : "输入 API Key"
              }
              autoComplete="new-password"
            />
            {props.profile?.hasApiKey && (
              <button
                type="button"
                className="button button-secondary settings-clear-key"
                disabled={props.busy || clearApiKey}
                onClick={() => {
                  setApiKey("");
                  setClearApiKey(true);
                }}
              >
                {clearApiKey ? "正在清除…" : "清除已保存密钥"}
              </button>
            )}
          </div>
          <small>
            {apiKey
              ? "输入停止后自动保存"
              : props.profile?.hasApiKey
                ? `已保存 ${props.profile.apiKeyMask ?? "••••••••"}`
                : requiresApiKey
                  ? "尚未设置 API Key"
                  : "留空仅适用于无需认证的本地接口"}
          </small>
        </div>
      </div>
      <div className="settings-api-guide">
        <header>
          <div>
            <strong>API Key 申请说明</strong>
            <span>网站和步骤备注会随当前供应商自动保存，可按实际情况修改。</span>
          </div>
          {isHttpUrl(apiKeyWebsite) && (
            <a
              className="button button-secondary"
              href={apiKeyWebsite.trim()}
              target="_blank"
              rel="noreferrer"
            >
              打开申请网站
            </a>
          )}
        </header>
        <div>
          <label className="field">
            <span>申请 API Key 网站</span>
            <input
              type="url"
              value={apiKeyWebsite}
              onChange={(event) => setApiKeyWebsite(event.target.value)}
              placeholder="https://provider.example.com/api-keys"
            />
          </label>
          <label className="field">
            <span>申请步骤备注</span>
            <textarea
              value={apiKeyGuide}
              rows={6}
              onChange={(event) => setApiKeyGuide(event.target.value)}
              placeholder="记录注册、开通服务、创建密钥和计费检查步骤。"
            />
          </label>
        </div>
      </div>
      {status && (
        <p
          className={`connection-result connection-${status.type}`}
          aria-live="polite"
        >
          {status.text}
        </p>
      )}
      <footer className="settings-connection-footer">
        <div>
          <button
            type="button"
            className="button button-primary"
            disabled={
              props.busy ||
              !name.trim() ||
              !baseUrl.trim() ||
              missingRequiredKey
            }
            onClick={() => void test()}
          >
            {status?.type === "testing"
              ? "测试中"
              : "连通性测试并更新模型"}
          </button>
        </div>
      </footer>
    </section>
  );
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

function connectionSignature(value: ProviderFormValue): string {
  return JSON.stringify({
    name: value.name.trim(),
    protocol: value.protocol,
    adapterType: value.adapterType,
    baseUrl: value.baseUrl.trim(),
    settings: value.settings,
    enabled: value.enabled
  });
}

function readApiKeyGuide(
  settings: Record<string, unknown>,
  preset: ProviderPreset | null
): { website: string; steps: string } {
  const internal = isRecord(settings[INTERNAL_SETTINGS_KEY])
    ? settings[INTERNAL_SETTINGS_KEY]
    : {};
  return {
    website: readString(internal.apiKeyWebsite) ?? preset?.apiKeyWebsite ?? "",
    steps: readString(internal.apiKeyGuide) ?? preset?.apiKeyGuide ?? ""
  };
}

function withApiKeyGuide(
  source: Record<string, unknown>,
  website: string,
  steps: string
): Record<string, unknown> {
  const settings = structuredClone(source);
  const existing = isRecord(settings[INTERNAL_SETTINGS_KEY])
    ? settings[INTERNAL_SETTINGS_KEY]
    : {};
  const normalizedWebsite = website.trim();
  const normalizedSteps = steps.trim();
  if (!normalizedWebsite && !normalizedSteps && Object.keys(existing).length === 0) {
    delete settings[INTERNAL_SETTINGS_KEY];
    return settings;
  }
  settings[INTERNAL_SETTINGS_KEY] = {
    ...existing,
    apiKeyWebsite: normalizedWebsite,
    apiKeyGuide: normalizedSteps
  };
  return settings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
