import { providerOAuthSettings, TRIPO_REGIONS, tripoRegion } from "@lyra/contracts";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  FrostApiUsageSnapshot,
  ProviderAccountSnapshot,
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
const MODEL_ADAPTERS: readonly ProviderAdapterType[] = [
  "frostapi-3d",
  "meshy",
  "tripo",
  "hunyuan",
  "stability-3d"
];

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
  enableAfterConnection?: boolean;
  afterConnection?: ReactNode;
  onSave: (value: ProviderFormValue) => Promise<ProviderProfileSnapshot>;
  onTest: (value: ProviderFormValue) => Promise<ProviderConnectionTestResult>;
  onQueryFrostApiUsage: (profileId: string) => Promise<FrostApiUsageSnapshot>;
  onQueryProviderAccount?: (profileId: string) => Promise<ProviderAccountSnapshot>;
  onDeleteCredential?: (profileId: string) => Promise<ProviderProfileSnapshot>;
  onImportCredential?: (profileId: string, value: unknown) => Promise<ProviderProfileSnapshot>;
  onStartOAuth?: (profileId: string, redirectUri: string) => Promise<{ state: string; authorizationUrl: string }>;
  onCompleteOAuth?: (state: string, code: string) => Promise<ProviderProfileSnapshot>;
  onOAuthStatus?: (profileId: string, state: string) => Promise<ProviderProfileSnapshot | null>;
}

export function ProviderConnectionSection(props: ProviderConnectionSectionProps) {
  const initialProtocol = props.preset?.protocol ?? props.profile?.protocol ?? "openai-compatible";
  const initialAdapter = props.preset?.adapterType ?? props.profile?.adapterType ??
    (props.serviceType === "model" ? "frostapi-3d" : initialProtocol);
  const baseSettings = providerOAuthSettings({
    settings: props.profile?.settings ?? props.preset?.settings ?? {},
    baseUrl: props.profile?.baseUrl ?? props.preset?.baseUrl ?? "",
    serviceType: props.serviceType,
    adapterType: initialAdapter
  });
  const savedSettings = useRef(baseSettings);
  const [gcpProjectId, setGcpProjectId] = useState(readString(baseSettings.gcpProjectId) ?? "");
  const [credentialProfile, setCredentialProfile] = useState(props.profile);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const credentialBusyRef = useRef(false);
  const initialGuide = readProviderMetadata(baseSettings, props.preset);
  const [name, setName] = useState(props.profile?.name ?? props.preset?.name ?? "");
  const [protocol, setProtocol] = useState<ProviderProtocol>(initialProtocol);
  const [adapterType, setAdapterType] = useState<ProviderAdapterType>(initialAdapter);
  const [baseUrl, setBaseUrl] = useState(props.profile?.baseUrl ?? props.preset?.baseUrl ?? "");
  const oauthDefaults = baseSettings;
  const [oauthAuthorizeUrl, setOauthAuthorizeUrl] = useState(readString(oauthDefaults.oauthAuthorizeUrl) ?? "");
  const [oauthTokenUrl, setOauthTokenUrl] = useState(readString(oauthDefaults.oauthTokenUrl) ?? "");
  const [oauthClientId, setOauthClientId] = useState(readString(oauthDefaults.oauthClientId) ?? "");
  const [oauthCallbackUrl, setOauthCallbackUrl] = useState("");
  const [oauthSession, setOauthSession] = useState<{ profileId: string; state: string } | null>(null);
  useEffect(() => {
    if (!oauthSession || !props.onOAuthStatus) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 10 * 60_000;
    const poll = async () => {
      try {
        const profile = await props.onOAuthStatus!(oauthSession.profileId, oauthSession.state);
        if (cancelled) return;
        if (profile) {
          markSaved(currentValue(), profile);
          setOauthSession(null);
          setAuthorizationUrl("");
          setOauthCallbackUrl("");
          setStatus({ type: "success", text: "OAuth 授权成功，账号已自动保存，无需粘贴回调地址" });
          void loadAccount(profile.id);
          return;
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof Error && error.name === "OAuthAuthorizationError") {
          setOauthSession(null);
          setAuthorizationUrl("");
          setStatus({ type: "error", text: error.message });
          return;
        }
        // Retry transient network errors; keep manual callback available.
      }
      if (!cancelled && Date.now() < deadline) timer = setTimeout(() => void poll(), 1500);
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [oauthSession, props.onOAuthStatus]);
  const [authorizationUrl, setAuthorizationUrl] = useState("");
  const [tokenJson, setTokenJson] = useState("");
  const tokenFileInputRef = useRef<HTMLInputElement>(null);
  const [apiKey, setApiKey] = useState("");
  const [hasSavedApiKey, setHasSavedApiKey] = useState(Boolean(props.profile?.hasApiKey));
  const [savedApiKeyMask, setSavedApiKeyMask] = useState(props.profile?.apiKeyMask ?? null);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [secondaryApiKey, setSecondaryApiKey] = useState("");
  const [hasSavedSecondaryApiKey, setHasSavedSecondaryApiKey] = useState(
    Boolean(props.profile?.hasSecondaryApiKey)
  );
  const [savedSecondaryApiKeyMask, setSavedSecondaryApiKeyMask] = useState(
    props.profile?.secondaryApiKeyMask ?? null
  );
  const [clearSecondaryApiKey, setClearSecondaryApiKey] = useState(false);
  const [enabled, setEnabled] = useState(props.profile?.enabled ?? true);
  type CredentialMode = "oauth" | "token" | "apikey";
  const [credentialMode, setCredentialMode] = useState<CredentialMode>(
    readString(props.profile?.settings.authMode) === "oauth" ? "oauth" :
      ["token", "json"].includes(readString(props.profile?.settings.authMode) ?? "") ? "token" : "apikey"
  );
  const [pendingEnable, setPendingEnable] = useState(
    () => Boolean(props.enableAfterConnection)
  );
  const [apiKeyWebsite, setApiKeyWebsite] = useState(initialGuide.website);
  const [apiKeyGuide, setApiKeyGuide] = useState(initialGuide.steps);
  const selectedTripoRegion = tripoRegion(baseUrl);
  const effectiveKeyWebsite = adapterType === "tripo" && selectedTripoRegion !== "custom"
    ? TRIPO_REGIONS[selectedTripoRegion].keyWebsite : apiKeyWebsite;
  const [status, setStatus] = useState<ConnectionStatus | null>(props.feedback);
  const [usage, setUsage] = useState<FrostApiUsageSnapshot | null>(null);
  const [usageStatus, setUsageStatus] = useState<"idle" | "loading" | "error">("idle");
  const [usageError, setUsageError] = useState("");
  const [account, setAccount] = useState<ProviderAccountSnapshot | null>(null);
  const [accountStatus, setAccountStatus] = useState<"idle" | "loading" | "error">("idle");
  const [accountError, setAccountError] = useState("");
  const pairCredentials = props.preset?.credentialMode === "pair" || adapterType === "hunyuan-image";
  const requiresApiKey = Boolean(props.preset) || props.serviceType === "model";
  const keepsExistingKey = hasSavedApiKey && !clearApiKey;
  const keepsExistingSecondaryKey = Boolean(
    hasSavedSecondaryApiKey && !clearSecondaryApiKey
  );
  const validationEnabled = enabled || pendingEnable;
  const missingConfiguredKey = credentialMode === "apikey" && requiresApiKey && !keepsExistingKey && !apiKey.trim();
  const missingConfiguredSecondaryKey =
    credentialMode === "apikey" && pairCredentials && !keepsExistingSecondaryKey && !secondaryApiKey.trim();
  const missingRequiredKey = validationEnabled && missingConfiguredKey;
  const missingRequiredSecondaryKey =
    validationEnabled && missingConfiguredSecondaryKey;
  const missingUsageKey = !keepsExistingKey && !apiKey.trim();
  const lastPersisted = useRef("");
  const frostApi = isFrostApiProfile(props.profile, props.preset, adapterType);
  const canUseOAuth = Boolean(
    isHttpUrl(oauthAuthorizeUrl) && isHttpUrl(oauthTokenUrl) && oauthClientId.trim()
  );
  // Only providers with an explicit OAuth configuration expose the OAuth/JSON
  // login flows.  A regular provider remains API-key-only unless it already
  // has an imported credential that needs to be managed.
  const savedAuthMode = readString(props.profile?.settings.authMode);
  const supportsTokenImport = canUseOAuth || credentialMode === "token" || savedAuthMode === "token" || savedAuthMode === "json";

  useEffect(() => {
    if (!canUseOAuth && credentialMode === "oauth") {
      setCredentialMode(supportsTokenImport ? "token" : "apikey");
    }
  }, [canUseOAuth, credentialMode, supportsTokenImport]);

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
        savedSettings.current,
        initialGuide.website,
        initialGuide.steps,
        props.preset?.id,
        oauthAuthorizeUrl,
        oauthTokenUrl,
        oauthClientId,
        apiKey.trim() ? "apikey" : readString(savedSettings.current.authMode) ?? "apikey"
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
        { ...savedSettings.current, ...(baseSettings.antigravity === true ? { gcpProjectId: gcpProjectId.trim() } : {}) },
        effectiveKeyWebsite,
        apiKeyGuide,
        props.preset?.id,
        oauthAuthorizeUrl,
        oauthTokenUrl,
        oauthClientId,
        apiKey.trim() ? "apikey" : readString(savedSettings.current.authMode) ?? "apikey"
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
      savedSettings.current = providerOAuthSettings(profile);
      setCredentialProfile(profile);
      setName(profile.name);
      setProtocol(profile.protocol);
      setAdapterType(profile.adapterType);
      setBaseUrl(profile.baseUrl);
      setOauthAuthorizeUrl(readString(savedSettings.current.oauthAuthorizeUrl) ?? "");
      setOauthTokenUrl(readString(savedSettings.current.oauthTokenUrl) ?? "");
      setOauthClientId(readString(savedSettings.current.oauthClientId) ?? "");
      setHasSavedApiKey(profile.hasApiKey);
      setSavedApiKeyMask(profile.apiKeyMask);
      setHasSavedSecondaryApiKey(profile.hasSecondaryApiKey);
      setSavedSecondaryApiKeyMask(profile.secondaryApiKeyMask);
    } else {
      if (value.apiKey) {
        setHasSavedApiKey(true);
        setSavedApiKeyMask("••••••••");
      }
      if (value.clearApiKey) {
        setHasSavedApiKey(false);
        setSavedApiKeyMask(null);
      }
      if (value.secondaryApiKey) {
        setHasSavedSecondaryApiKey(true);
        setSavedSecondaryApiKeyMask("••••••••");
      }
      if (value.clearSecondaryApiKey) {
        setHasSavedSecondaryApiKey(false);
        setSavedSecondaryApiKeyMask(null);
      }
    }
    setEnabled(savedValue.enabled);
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
      missingConfiguredKey ||
      missingConfiguredSecondaryKey ||
      props.busy || credentialBusyRef.current
    ) return;
    setStatus({ type: "saving", text: "正在自动保存…" });
    const timer = window.setTimeout(() => {
      if (credentialBusyRef.current) return;
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
    pendingEnable,
    props.busy,
    protocol,
    adapterType,
    secondaryApiKey,
    oauthAuthorizeUrl,
    oauthTokenUrl,
    oauthClientId,
    gcpProjectId,
    credentialMode,
    credentialBusy
  ]);

  async function test() {
    const value = {
      ...currentValue(),
      enabled: pendingEnable ? true : enabled
    };
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
      setPendingEnable(false);
      markSaved(value);
      setStatus({
        type: "success",
        text: `连接成功，已同步 ${result.modelCount} 个可用模型，耗时 ${result.elapsedMs} ms`
      });
    } catch (error) {
      setStatus({ type: "error", text: toErrorMessage(error) });
    }
  }

  async function queryFrostApiUsage() {
    if (!props.profile || props.busy || usageStatus === "loading") return;
    const value = currentValue();
    if (
      !value.name ||
      !value.baseUrl ||
      missingUsageKey
    ) return;
    setUsageStatus("loading");
    setUsageError("");
    try {
      const profile = await props.onSave(value);
      markSaved(value, profile);
      setUsage(await props.onQueryFrostApiUsage(profile.id));
      setUsageStatus("idle");
    } catch (error) {
      setUsage(null);
      setUsageError(toErrorMessage(error));
      setUsageStatus("error");
    }
  }

  async function queryProviderAccount() {
    if (!props.profile || !props.onQueryProviderAccount || props.busy || accountStatus === "loading") return;
    setAccountStatus("loading");
    setAccountError("");
    try {
      setAccount(await props.onQueryProviderAccount(props.profile.id));
      setAccountStatus("idle");
    } catch (error) {
      setAccount(null);
      setAccountError(toErrorMessage(error));
      setAccountStatus("error");
    }
  }

  async function startOAuth() {
    if (!props.onStartOAuth || props.busy || credentialBusyRef.current || !canUseOAuth) return;
    credentialBusyRef.current = true;
    setCredentialBusy(true);
    try {
      const value = currentValue();
      const saved = await props.onSave(value);
      markSaved(value, saved);
      const result = await props.onStartOAuth(saved.id, `${window.location.origin}${window.location.pathname}`);
      setAuthorizationUrl(result.authorizationUrl);
      setOauthSession({ profileId: saved.id, state: result.state });
      setStatus({ type: "success", text: "授权链接已生成，可复制或在浏览器中打开（10 分钟内有效）" });
    } catch (error) {
      setStatus({ type: "error", text: toErrorMessage(error) });
    } finally {
      credentialBusyRef.current = false;
      setCredentialBusy(false);
    }
  }

  async function copyAuthorizationUrl() {
    if (!authorizationUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(authorizationUrl);
      } else {
        throw new Error("clipboard unavailable");
      }
      setStatus({ type: "success", text: "授权链接已复制" });
    } catch {
      // Clipboard API is unavailable on plain HTTP or in some embedded
      // browsers. Use the same fallback as desktop OAuth clients.
      const textarea = document.createElement("textarea");
      textarea.value = authorizationUrl;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      setStatus(copied
        ? { type: "success", text: "授权链接已复制" }
        : { type: "error", text: "复制失败，请手动选择并复制授权链接。" });
    }
  }

  async function loadAccount(profileId: string) {
    if (!props.onQueryProviderAccount) return;
    setAccountStatus("loading");
    setAccountError("");
    try {
      setAccount(await props.onQueryProviderAccount(profileId));
      setAccountStatus("idle");
    } catch (error) {
      // The saved credential card stays visible even when quota lookup fails.
      setAccountError(toErrorMessage(error));
      setAccountStatus("error");
    }
  }

  async function importTokenJson() {
    if (!props.onImportCredential || props.busy || credentialBusyRef.current || !tokenJson.trim()) return;
    credentialBusyRef.current = true;
    setCredentialBusy(true);
    try {
      setStatus({ type: "saving", text: "正在导入凭据…" });
      const saved = props.profile ?? await props.onSave(currentValue());
      const profile = await props.onImportCredential(saved.id, tokenJson.trim());
      setTokenJson("");
      setAccount(null);
      markSaved(currentValue(), profile);
      setStatus({ type: "success", text: "凭据已导入并安全保存" });
      await loadAccount(profile.id);
    } catch (error) {
      setStatus({ type: "error", text: toErrorMessage(error) });
    } finally {
      credentialBusyRef.current = false;
      setCredentialBusy(false);
    }
  }

  async function deleteCredential() {
    if (!credentialProfile || !props.onDeleteCredential || props.busy || credentialBusyRef.current) return;
    credentialBusyRef.current = true;
    setCredentialBusy(true);
    try {
      const profile = await props.onDeleteCredential(credentialProfile.id);
      markSaved(currentValue(), profile);
      setAccount(null);
      setAccountError("");
      setUsage(null);
      setAuthorizationUrl("");
      setOauthCallbackUrl("");
      setPendingEnable(false);
      setStatus({ type: "success", text: "访问令牌、刷新令牌和账号信息已删除" });
    } catch (error) {
      setStatus({ type: "error", text: toErrorMessage(error) });
    } finally {
      credentialBusyRef.current = false;
      setCredentialBusy(false);
    }
  }

  async function importTokenFile(file: File) {
    if (!props.onImportCredential || props.busy) return;
    try {
      const raw = (await file.text()).trim();
      if (!raw) throw new Error("JSON 文件为空。");
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "string") {
        setTokenJson(parsed);
      } else if (parsed && typeof parsed === "object") {
        setTokenJson(JSON.stringify(parsed, null, 2));
      } else {
        throw new Error("凭据文件必须是 JSON 对象或 Token 字符串。");
      }
      setStatus({ type: "success", text: `已读取 ${file.name}，请点击导入 Token JSON。` });
    } catch (error) {
      setStatus({ type: "error", text: error instanceof SyntaxError ? "凭据文件必须是有效 JSON。" : toErrorMessage(error) });
    } finally {
      if (tokenFileInputRef.current) tokenFileInputRef.current.value = "";
    }
  }

  async function completeManualOAuth() {
    if (!props.onCompleteOAuth || props.busy || credentialBusyRef.current) return;
    const raw = oauthCallbackUrl.trim();
    if (!raw) {
      setStatus({ type: "error", text: "请粘贴授权完成后的回调地址。" });
      return;
    }
    try {
      const url = new URL(raw.includes("://") ? raw : `http://localhost/?${raw.replace(/^\?/, "")}`);
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!state || !code) throw new Error("回调地址中缺少 code 或 state。 ");
      credentialBusyRef.current = true;
      setCredentialBusy(true);
      setStatus({ type: "testing", text: "正在完成 OAuth 授权…" });
      const profile = await props.onCompleteOAuth(state, code);
      setOauthCallbackUrl("");
      setCredentialMode("oauth");
      markSaved(currentValue(), profile);
      setAuthorizationUrl("");
      setAccount(null);
      setStatus({ type: "success", text: "OAuth 授权完成，凭据已保存" });
      await loadAccount(profile.id);
    } catch (error) {
      setStatus({ type: "error", text: toErrorMessage(error) });
    } finally {
      credentialBusyRef.current = false;
      setCredentialBusy(false);
    }
  }

  async function removePrimaryApiKey() {
    if (props.busy || clearApiKey || !hasSavedApiKey) return;
    const previousEnabled = enabled;
    const value: ProviderFormValue = {
      ...currentValue(),
      apiKey: "",
      clearApiKey: true,
      enabled: requiresApiKey ? false : enabled
    };
    setPendingEnable(false);
    setEnabled(value.enabled);
    setHasSavedApiKey(false);
    setSavedApiKeyMask(null);
    setClearApiKey(true);
    setUsage(null);
    setStatus({ type: "saving", text: "正在清除 API Key…" });
    try {
      const profile = await props.onSave(value);
      markSaved(value, profile);
      setStatus({ type: "saved", text: "API Key 已清除" });
    } catch (error) {
      setEnabled(previousEnabled);
      setHasSavedApiKey(true);
      setSavedApiKeyMask(props.profile?.apiKeyMask ?? "••••••••");
      setClearApiKey(false);
      setStatus({ type: "error", text: toErrorMessage(error) });
    }
  }

  async function removeSecondaryApiKey() {
    if (props.busy || clearSecondaryApiKey || !hasSavedSecondaryApiKey) return;
    const previousEnabled = enabled;
    const value: ProviderFormValue = {
      ...currentValue(),
      secondaryApiKey: "",
      clearSecondaryApiKey: true,
      enabled: false
    };
    setPendingEnable(false);
    setEnabled(false);
    setHasSavedSecondaryApiKey(false);
    setSavedSecondaryApiKeyMask(null);
    setClearSecondaryApiKey(true);
    setStatus({ type: "saving", text: "正在清除 SecretKey…" });
    try {
      const profile = await props.onSave(value);
      markSaved(value, profile);
      setStatus({ type: "saved", text: "SecretKey 已清除" });
    } catch (error) {
      setEnabled(previousEnabled);
      setHasSavedSecondaryApiKey(true);
      setSavedSecondaryApiKeyMask(props.profile?.secondaryApiKeyMask ?? "••••••••");
      setClearSecondaryApiKey(false);
      setStatus({ type: "error", text: toErrorMessage(error) });
    }
  }

  function changeEnabled(nextEnabled: boolean) {
    setPendingEnable(false);
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
  const primaryPlaceholder = hasSavedApiKey
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
            ) : props.serviceType === "model" ? (
              <select
                value={adapterType}
                onChange={(event) => {
                  setProtocol("openai-compatible");
                  setAdapterType(event.target.value as ProviderAdapterType);
                }}
              >
                {MODEL_ADAPTERS.map((value) => (
                  <option value={value} key={value}>{adapterLabel(value)}</option>
                ))}
              </select>
            ) : (
              <select
                value={protocol}
                onChange={(event) => {
                  const value = event.target.value as ProviderProtocol;
                  setProtocol(value);
                  setAdapterType(value);
                }}
              >
                {Object.entries(protocolLabels)
                  .filter(([value]) => props.serviceType !== "image" || value !== "anthropic")
                  .map(([value, label]) => (
                  <option value={value} key={value}>{label}</option>
                  ))}
              </select>
            )}
          </label>
          {adapterType === "tripo" && (
            <label className="field settings-grid-wide">
              <span>服务站点</span>
              <select aria-label="Tripo 服务站点" value={selectedTripoRegion} disabled={props.busy || credentialBusy}
                onChange={(event) => {
                  const region = event.target.value;
                  if (region !== "international" && region !== "china") return;
                  setBaseUrl(TRIPO_REGIONS[region].baseUrl);
                  setApiKeyWebsite(TRIPO_REGIONS[region].keyWebsite);
                  setAccount(null);
                  setAccountError("");
                  setAccountStatus("idle");
                  setStatus(null);
                }}>
                <option value="international">国际站</option>
                <option value="china">国内站</option>
                {selectedTripoRegion === "custom" && <option value="custom">自定义地址</option>}
              </select>
            </label>
          )}
          <label className="field settings-grid-wide">
            <span>基础 URL</span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </label>
          <div className="settings-grid-wide provider-credential-mode" role="tablist" aria-label="登录方式">
            {canUseOAuth && <button type="button" className={credentialMode === "oauth" ? "active" : ""} onClick={() => setCredentialMode("oauth")}>🌐 OAuth 授权</button>}
            {supportsTokenImport && <button type="button" className={credentialMode === "token" ? "active" : ""} onClick={() => setCredentialMode("token")}>▤ Token / JSON</button>}
            <button type="button" className={credentialMode === "apikey" ? "active" : ""} onClick={() => setCredentialMode("apikey")}>🔑 API Key</button>
          </div>
          {baseSettings.antigravity === true && credentialMode === "oauth" && <label className="field settings-grid-wide">
            <span>GCP Project ID（可选）</span>
            <input value={gcpProjectId} onChange={(event) => setGcpProjectId(event.target.value)} placeholder="your-gcp-project-id" disabled={props.busy || credentialBusy} />
          </label>}
          {credentialMode === "apikey" && (
            <SecretField
              id="provider-primary-key"
              label={`${primaryLabel}${requiresApiKey ? "（必填）" : "（可选）"}`}
              value={apiKey}
              saved={hasSavedApiKey}
              mask={savedApiKeyMask}
              clearing={clearApiKey}
              disabled={props.busy}
              placeholder={primaryPlaceholder}
              onChange={setApiKey}
              onClear={() => void (props.onDeleteCredential ? deleteCredential() : removePrimaryApiKey())}
            />
          )}

          {credentialMode === "oauth" && (
            <div className="settings-grid-wide settings-oauth-fields">
              <p className="settings-oauth-hint">如你不明白在做什么请使用官方APIkey，使用导致的问题请自行解决；</p>
              <button type="button" className="button button-primary" disabled={props.busy || credentialBusy || !canUseOAuth} onClick={() => void startOAuth()}>
                {credentialBusy ? "处理中…" : authorizationUrl ? "重新生成授权链接" : "生成授权链接"}
              </button>
              {!canUseOAuth && <small>此供应商尚未配置 OAuth，请使用 API Key。</small>}
              <div className="settings-oauth-link">
                <label className="field">
                  <span>授权链接</span>
                  <div className="settings-oauth-link-row">
                    <input value={authorizationUrl} readOnly aria-label="OAuth 授权链接" placeholder="点击上方按钮生成带 PKCE 校验的授权链接" onFocus={(event) => event.currentTarget.select()} />
                    <button type="button" className="button button-secondary" disabled={!authorizationUrl} onClick={() => void copyAuthorizationUrl()}>复制</button>
                  </div>
                </label>
                <a className={`button button-primary settings-oauth-open${authorizationUrl ? "" : " disabled"}`} href={authorizationUrl || undefined} aria-disabled={!authorizationUrl} target="_blank" rel="noopener noreferrer">在浏览器中打开</a>
              </div>
              <label className="field">
                <span>手动输入回调地址</span>
                <input value={oauthCallbackUrl} onChange={(event) => setOauthCallbackUrl(event.target.value)} placeholder="粘贴完整回调地址，包含 code 和 state" />
              </label>
              <small>OpenAI 授权结束后，复制浏览器地址栏中的 localhost:1455/auth/callback 地址，即使该页面未打开，也可在此粘贴完成授权。</small>
              <details className="settings-oauth-advanced" open={!canUseOAuth}>
                <summary>高级 OAuth 配置</summary>
                <label className="field"><span>OAuth 授权地址</span><input value={oauthAuthorizeUrl} onChange={(event) => { setOauthAuthorizeUrl(event.target.value); setAuthorizationUrl(""); }} /></label>
                <label className="field"><span>OAuth Token 地址</span><input value={oauthTokenUrl} onChange={(event) => { setOauthTokenUrl(event.target.value); setAuthorizationUrl(""); }} /></label>
                <label className="field"><span>OAuth Client ID</span><input value={oauthClientId} onChange={(event) => { setOauthClientId(event.target.value); setAuthorizationUrl(""); }} /></label>
              </details>
            </div>
          )}

          {credentialMode === "token" && (
            <div className="settings-grid-wide settings-token-import">
              <label className="field">
                <span>Token / JSON 凭据</span>
                <textarea
                  value={tokenJson}
                  onChange={(event) => setTokenJson(event.target.value)}
                  rows={5}
                  spellCheck={false}
                  placeholder={'粘贴 JSON，例如 {"access_token":"…","refresh_token":"…"}'}
                />
              </label>
              <small>支持 access_token、refresh_token、expires_at 等字段；原文不会写入数据库。</small>
              <input
                ref={tokenFileInputRef}
                type="file"
                accept=".json,application/json,text/plain"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importTokenFile(file);
                }}
              />
              <button type="button" className="button button-secondary" disabled={props.busy} onClick={() => tokenFileInputRef.current?.click()}>
                选择 JSON 文件
              </button>
              {hasSavedApiKey && <small className="settings-credential-status">已有 Token 凭据，重新导入可替换。</small>}
            </div>
          )}

          {hasSavedApiKey && credentialProfile && (
            <div className="settings-grid-wide provider-credential-status-card" aria-label="已保存的账号">
              <div>
                <strong>{account?.account ?? readString(credentialProfile.settings.credentialAccount) ?? credentialProfile.name}</strong>
                <small>{readString(credentialProfile.settings.authMode) === "oauth" ? "OAuth" : ["token", "json"].includes(readString(credentialProfile.settings.authMode) ?? "") ? "Token / JSON" : "API Key"} · 已保存</small>
                {(account?.accountId ?? readString(credentialProfile.settings.credentialAccountId)) && <small>账号 ID：{account?.accountId ?? readString(credentialProfile.settings.credentialAccountId)}</small>}
                {(account?.plan ?? readString(credentialProfile.settings.credentialPlan)) && <small>套餐：{account?.plan ?? readString(credentialProfile.settings.credentialPlan)}</small>}
                {readString(credentialProfile.settings.credentialExpiresAt) && <small>令牌到期：{new Date(String(credentialProfile.settings.credentialExpiresAt)).toLocaleString("zh-CN")}</small>}
                <small>{credentialProfile.hasSecondaryApiKey ? (pairCredentials ? "已保存双密钥" : "已保存刷新令牌") : "未保存刷新令牌"}</small>
                {account && <div className="provider-account-result" aria-live="polite">
                  {account.subscriptionExpiresAt && <span>订阅到期：{new Date(account.subscriptionExpiresAt).toLocaleString("zh-CN")}</span>}
                  {account.usage.supported ? account.usage.metrics.map((metric) => (
                    <div className="provider-quota-metric" key={metric.key}>
                      <span>{metric.label}：{formatUsageNumber(metric.value)} {metric.unit}</span>
                      {metric.unit === "%" && <progress aria-label={metric.label} max={100} value={metric.value} />}
                      {metric.resetAt && <small>重置于 {new Date(metric.resetAt).toLocaleString("zh-CN")}</small>}
                    </div>
                  )) : <span>{account.usage.reason}</span>}
                </div>}

              </div>
              <button type="button" className="button button-danger" disabled={props.busy || credentialBusy || !props.onDeleteCredential} onClick={() => void deleteCredential()}>
                删除凭据
              </button>
            </div>
          )}

          {pairCredentials && credentialMode === "apikey" && (
            <SecretField
              id="provider-secondary-key"
              label="SecretKey（必填）"
              value={secondaryApiKey}
              saved={hasSavedSecondaryApiKey}
              mask={savedSecondaryApiKeyMask}
              clearing={clearSecondaryApiKey}
              disabled={props.busy}
              placeholder={hasSavedSecondaryApiKey
                ? "已保存，输入新值可替换"
                : "输入 SecretKey"}
              onChange={setSecondaryApiKey}
              onClear={() => void removeSecondaryApiKey()}
            />
          )}
        </div>

        {status && (
          <p className={`connection-result connection-${status.type}`} aria-live="polite">
            {status.text}
          </p>
        )}
        {frostApi && usage && (
          <p className="provider-usage-result" aria-live="polite">
            {formatFrostApiUsage(usage)}
          </p>
        )}
        {frostApi && usageStatus === "error" && (
          <p className="connection-result connection-error" aria-live="polite">
            {usageError}
          </p>
        )}
        {accountStatus === "error" && <p className="connection-result connection-error">{accountError}</p>}
        <footer className="settings-connection-footer">
          {credentialMode === "token" && props.onImportCredential && (
            <button type="button" className="button button-secondary" disabled={props.busy || credentialBusy || !tokenJson.trim()} onClick={() => void importTokenJson()}>
              导入 Token JSON
            </button>
          )}
          {credentialMode === "oauth" && props.onCompleteOAuth && (
            <button type="button" className="button button-secondary" disabled={props.busy || credentialBusy || !oauthCallbackUrl.trim()} onClick={() => void completeManualOAuth()}>
              我已授权，继续
            </button>
          )}
          {frostApi && props.profile && (
            <button
              type="button"
              className="button button-secondary"
              disabled={
                props.busy ||
                usageStatus === "loading" ||
                !name.trim() ||
                !baseUrl.trim() ||
                missingUsageKey
              }
              onClick={() => void queryFrostApiUsage()}
            >
              {usageStatus === "loading" ? "查询中…" : "查询余额"}
            </button>
          )}
          {!frostApi && props.profile && props.onQueryProviderAccount && (
            <button type="button" className="button button-secondary" disabled={props.busy || accountStatus === "loading"} onClick={() => void queryProviderAccount()}>
              {accountStatus === "loading" ? "查询中…" : "查询账号/额度"}
            </button>
          )}
          <button
            type="button"
            className="button button-primary"
            disabled={
              props.busy ||
              !name.trim() ||
              !baseUrl.trim() ||
              missingConfiguredKey ||
              missingConfiguredSecondaryKey
            }
            onClick={() => void test()}
          >
            {status?.type === "testing" ? "测试中…" : "连通性测试并同步上游模型"}
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
            {isHttpUrl(effectiveKeyWebsite) && (
              <a
                className="button button-secondary"
                href={effectiveKeyWebsite.trim()}
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
                value={effectiveKeyWebsite}
                readOnly={adapterType === "tripo" && selectedTripoRegion !== "custom"}
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
          : props.clearing
            ? "密钥将在自动保存后清除"
            : props.saved
              ? `已保存 ${props.mask ?? "••••••••"}`
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
  providerKind?: string,
  oauthAuthorizeUrl?: string,
  oauthTokenUrl?: string,
  oauthClientId?: string,
  authMode?: string
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
  if (oauthAuthorizeUrl !== undefined) settings.oauthAuthorizeUrl = oauthAuthorizeUrl.trim();
  if (oauthTokenUrl !== undefined) settings.oauthTokenUrl = oauthTokenUrl.trim();
  if (oauthClientId !== undefined) settings.oauthClientId = oauthClientId.trim();
  if (authMode) settings.authMode = authMode;
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

function isFrostApiProfile(
  profile: ProviderProfileSnapshot | null,
  preset: ProviderPreset | null,
  adapterType: ProviderAdapterType
): boolean {
  if (preset?.id === "frostapi" || adapterType === "frostapi-3d") return true;
  const internal = profile?.settings[INTERNAL_SETTINGS_KEY];
  return Boolean(
    isRecord(internal) && internal.providerKind === "frostapi"
  );
}

function formatFrostApiUsage(usage: FrostApiUsageSnapshot): string {
  if (usage.mode === "unrestricted") {
    return `${usage.planName}：${formatUsageNumber(usage.balance)} ${usage.unit}`;
  }
  return `剩余 ${formatUsageNumber(usage.quota.remaining)} / ${formatUsageNumber(usage.quota.limit)} ${usage.quota.unit}，已用 ${formatUsageNumber(usage.quota.used)}`;
}

function formatUsageNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value);
}
