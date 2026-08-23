import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
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
  afterConnection?: ReactNode;
  onSave: (value: ProviderFormValue) => Promise<ProviderProfileSnapshot>;
  onTest: (value: ProviderFormValue) => Promise<ProviderConnectionTestResult>;
}

export function ProviderConnectionSection(props: ProviderConnectionSectionProps) {
  const initialProtocol = props.preset?.protocol ?? props.profile?.protocol ?? "openai-compatible";
  const initialAdapter = props.preset?.adapterType ?? props.profile?.adapterType ?? initialProtocol;
  const initialGuide = readProviderMetadata(
    props.profile?.settings ?? props.preset?.settings ?? {},
    props.preset
  );
  const [name, setName] = useState(props.profile?.name ?? props.preset?.name ?? "");
  const [protocol, setProtocol] = useState<ProviderProtocol>(initialProtocol);
  const [baseUrl, setBaseUrl] = useState(props.profile?.baseUrl ?? props.preset?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [secondaryApiKey, setSecondaryApiKey] = useState("");
  const [clearSecondaryApiKey, setClearSecondaryApiKey] = useState(false);
  const [enabled, setEnabled] = useState(props.profile?.enabled ?? true);
  const [apiKeyWebsite, setApiKeyWebsite] = useState(initialGuide.website);
  const [apiKeyGuide, setApiKeyGuide] = useState(initialGuide.steps);
  const [status, setStatus] = useState<ConnectionStatus | null>(props.feedback);
  const adapterType: ProviderAdapterType = props.preset?.adapterType ?? protocol;
  const pairCredentials = props.preset?.credentialMode === "pair" || adapterType === "hunyuan-image";
  const requiresApiKey = Boolean(props.preset) || props.serviceType === "model";
  const keepsExistingKey = Boolean(props.profile?.hasApiKey && !clearApiKey);
  const keepsExistingSecondaryKey = Boolean(
    props.profile?.hasSecondaryApiKey && !clearSecondaryApiKey
  );
  const missingRequiredKey = enabled && requiresApiKey && !keepsExistingKey && !apiKey.trim();
  const missingRequiredSecondaryKey =
    enabled && pairCredentials && !keepsExistingSecondaryKey && !secondaryApiKey.trim();
  const lastPersisted = useRef("");

  useEffect(() => {
    lastPersisted.current = connectionSignature(initialValue());
  }, []);

  useEffect(() => {
    if (props.feedback) setStatus(props.feedback);
  }, [props.feedback]);

  useEffect(() => {
    if (status?.type !== "saved" && status?.type !== "success") return;
    const timer = window.setTimeout(() => setStatus(null), 3_000);
    return () => window.clearTimeout(timer);
  }, [status]);

  function initialValue(): ProviderFormValue {
    return {
      name: props.profile?.name ?? props.preset?.name ?? "",
      protocol: initialProtocol,
      adapterType: initialAdapter,
      baseUrl: props.profile?.baseUrl ?? props.preset?.baseUrl ?? "",
      settings: withProviderMetadata(
        props.profile?.settings ?? props.preset?.settings ?? {},
        initialGuide.website,
        initialGuide.steps,
        props.preset?.id
      ),
      apiKey: "",
      clearApiKey: false,
      secondaryApiKey: "",
      clearSecondaryApiKey: false,
      enabled: props.profile?.enabled ?? true
    };
  }

  function currentValue(): ProviderFormValue {
    return {
      name: name.trim(),
      protocol: props.preset?.protocol ?? protocol,
      adapterType,
      baseUrl: baseUrl.trim(),
      settings: withProviderMetadata(
        props.profile?.settings ?? props.preset?.settings ?? {},
        apiKeyWebsite,
        apiKeyGuide,
        props.preset?.id
      ),
      apiKey: apiKey.trim(),
      clearApiKey,
      secondaryApiKey: secondaryApiKey.trim(),
      clearSecondaryApiKey,
      enabled
    };
  }

  function markSaved(value: ProviderFormValue, profile?: ProviderProfileSnapshot) {
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
    if (value.apiKey) setApiKey("");
    if (value.secondaryApiKey) setSecondaryApiKey("");
    if (value.clearApiKey) setClearApiKey(false);
    if (value.clearSecondaryApiKey) setClearSecondaryApiKey(false);
  }

  useEffect(() => {
    const value = currentValue();
    const connectionChanged = connectionSignature(value) !== lastPersisted.current;
    const secretChanged = Boolean(value.apiKey || value.secondaryApiKey) ||
      value.clearApiKey || value.clearSecondaryApiKey;
    if (!connectionChanged && !secretChanged) return;
    if (
      !value.name ||
      !value.baseUrl ||
      missingRequiredKey ||
      missingRequiredSecondaryKey ||
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
    apiKeyGuide,
    apiKeyWebsite,
    baseUrl,
    clearApiKey,
    clearSecondaryApiKey,
    enabled,
    missingRequiredKey,
    missingRequiredSecondaryKey,
    name,
    props.busy,
    protocol,
    secondaryApiKey
  ]);

  async function test() {
    const value = currentValue();
    if (
      !value.name ||
      !value.baseUrl ||
      missingRequiredKey ||
      missingRequiredSecondaryKey ||
      props.busy
    ) return;
    setStatus({ type: "testing", text: "正在保存配置并读取模型…" });
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

  function changeEnabled(nextEnabled: boolean) {
    if (!props.profile) {
      setEnabled(nextEnabled);
      return;
    }
    const previousValue = currentValue();
    const nextValue = { ...previousValue, enabled: nextEnabled };
    lastPersisted.current = connectionSignature(nextValue);
    setEnabled(nextEnabled);
    setStatus({ type: "saving", text: "正在保存启用状态…" });
    void props.onSave(nextValue)
      .then((profile) => {
        markSaved(nextValue, profile);
        setStatus({
          type: "saved",
          text: nextEnabled ? "供应商已启用" : "供应商已停用"
        });
      })
      .catch((error: unknown) => {
        lastPersisted.current = connectionSignature(previousValue);
        setEnabled(previousValue.enabled);
        setStatus({ type: "error", text: toErrorMessage(error) });
      });
  }

  const primaryLabel = pairCredentials ? "SecretId" : "API Key";
  const primaryPlaceholder = props.profile?.hasApiKey
    ? "已保存，输入新值可替换"
    : pairCredentials ? "输入 SecretId" : "输入 API Key";

  return (
    <Fragment>
      <section className="settings-detail-section settings-connection-section">
        <header>
          <div>
            <strong>连接信息</strong>
            <span>修改后自动保存</span>
          </div>
          <label className="settings-enable-control">
            <span>{enabled ? "已启用" : "已停用"}</span>
            <span className="switch">
              <input
                type="checkbox"
                checked={enabled}
                disabled={props.busy}
                onChange={(event) => changeEnabled(event.target.checked)}
              />
              <span />
            </span>
          </label>
        </header>

        <div className="settings-connection-editor">
          <label className="field">
            <span>供应商名称</span>
            <input
              value={name}
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
                onChange={(event) => setProtocol(event.target.value as ProviderProtocol)}
              >
                {Object.entries(protocolLabels)
                  .filter(([value]) => props.serviceType === "model"
                    ? value === "openai-compatible"
                    : props.serviceType !== "image" || value !== "anthropic")
                  .map(([value, label]) => (
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
          <SecretField
            id="provider-primary-key"
            label={`${primaryLabel}${requiresApiKey ? "（必填）" : "（可选）"}`}
            value={apiKey}
            saved={Boolean(props.profile?.hasApiKey)}
            mask={props.profile?.apiKeyMask}
            clearing={clearApiKey}
            disabled={props.busy}
            placeholder={primaryPlaceholder}
            onChange={setApiKey}
            onClear={() => {
              setApiKey("");
              setClearApiKey(true);
            }}
          />

          {pairCredentials && (
            <SecretField
              id="provider-secondary-key"
              label="SecretKey（必填）"
              value={secondaryApiKey}
              saved={Boolean(props.profile?.hasSecondaryApiKey)}
              mask={props.profile?.secondaryApiKeyMask}
              clearing={clearSecondaryApiKey}
              disabled={props.busy}
              placeholder={props.profile?.hasSecondaryApiKey
                ? "已保存，输入新值可替换"
                : "输入 SecretKey"}
              onChange={setSecondaryApiKey}
              onClear={() => {
                setSecondaryApiKey("");
                setClearSecondaryApiKey(true);
              }}
            />
          )}
        </div>

        {status && (
          <p className={`connection-result connection-${status.type}`} aria-live="polite">
            {status.text}
          </p>
        )}
        <footer className="settings-connection-footer">
          <button
            type="button"
            className="button button-primary"
            disabled={
              props.busy ||
              !name.trim() ||
              !baseUrl.trim() ||
              missingRequiredKey ||
              missingRequiredSecondaryKey
            }
            onClick={() => void test()}
          >
            {status?.type === "testing" ? "测试中…" : "连通性测试并更新模型"}
          </button>
        </footer>
      </section>

      {props.afterConnection}

      <section className="settings-api-guide-section" aria-label="API Key 申请说明">
        <div className="settings-api-guide">
          <header>
            <div>
              <strong>API Key 申请说明</strong>
              <span>供应商申请入口和配置备注，可按实际情况修改。</span>
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
              <span>申请网站</span>
              <input
                type="url"
                value={apiKeyWebsite}
                onChange={(event) => setApiKeyWebsite(event.target.value)}
                placeholder="https://provider.example.com/api-keys"
              />
            </label>
            <label className="field">
              <span>申请步骤与备注</span>
              <textarea
                value={apiKeyGuide}
                rows={6}
                onChange={(event) => setApiKeyGuide(event.target.value)}
                placeholder="记录注册、开通服务、创建密钥和计费检查步骤。"
              />
            </label>
          </div>
        </div>
      </section>
    </Fragment>
  );
}

function SecretField(props: {
  id: string;
  label: string;
  value: string;
  saved: boolean;
  mask: string | null | undefined;
  clearing: boolean;
  disabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="field settings-api-key-field settings-grid-wide">
      <span id={`${props.id}-label`}>{props.label}</span>
      <div className="settings-api-key-control">
        <input
          aria-labelledby={`${props.id}-label`}
          type="password"
          value={props.value}
          disabled={props.clearing}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={props.placeholder}
          autoComplete="new-password"
        />
        {props.saved && (
          <button
            type="button"
            className="button button-secondary settings-clear-key"
            disabled={props.disabled || props.clearing}
            onClick={props.onClear}
          >
            {props.clearing ? "正在清除…" : "清除已保存密钥"}
          </button>
        )}
      </div>
      <small>
        {props.value
          ? "输入停止后自动保存"
          : props.saved
            ? `已保存 ${props.mask ?? "••••••••"}`
            : props.clearing
              ? "密钥将在自动保存后清除"
              : "尚未设置"}
      </small>
    </div>
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

function readProviderMetadata(
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

function withProviderMetadata(
  source: Record<string, unknown>,
  website: string,
  steps: string,
  providerKind?: string
): Record<string, unknown> {
  const settings = structuredClone(source);
  const existing = isRecord(settings[INTERNAL_SETTINGS_KEY])
    ? settings[INTERNAL_SETTINGS_KEY]
    : {};
  const metadata: Record<string, unknown> = {
    ...existing,
    apiKeyWebsite: website.trim(),
    apiKeyGuide: steps.trim()
  };
  if (providerKind) metadata.providerKind = providerKind;
  settings[INTERNAL_SETTINGS_KEY] = metadata;
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
