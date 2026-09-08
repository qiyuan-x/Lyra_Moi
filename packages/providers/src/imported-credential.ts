type JsonRecord = Record<string, unknown>;

export interface ImportedCredential {
  accessToken: string;
  refreshToken: string | null;
  settings: JsonRecord;
}

/** Read exported account formats. Only the allowlisted display metadata leaves this module. */
export function parseImportedCredential(value: unknown): ImportedCredential {
  const source = normalize(value);
  const accessToken = text(source.access_token, source.accessToken, source.token,
    source.api_key, source.apiKey, source.OPENAI_API_KEY, source.openai_api_key,
    source.codex_access_token, source.personal_access_token,
    record(source.headers).authorization, record(source.headers).Authorization)?.replace(/^Bearer\s+/iu, "");
  if (!accessToken) throw new Error("凭据缺少 access token、token 或 apiKey。");
  const refreshToken = text(source.refresh_token, source.refreshToken, source.session_token, source.sessionToken);
  // JWT claims are display hints only, never proof of identity or authorization.
  const accessClaims = jwtClaims(accessToken);
  const idClaims = jwtClaims(text(source.id_token, source.idToken));
  const auth = { ...record(accessClaims["https://api.openai.com/auth"]), ...record(idClaims["https://api.openai.com/auth"]) };
  const user = { ...record(accessClaims["https://api.openai.com/profile"]), ...record(source.user) };
  const account = record(source.account);
  const explicitMode = text(source.mode, source.auth_mode, source.type);
  const mode = explicitMode === "oauth" || (explicitMode !== "token" && (refreshToken || source.id_token || source.idToken)) ? "oauth" : "token";
  return {
    accessToken,
    refreshToken,
    settings: {
      authMode: mode,
      credentialImportedAt: new Date().toISOString(),
      credentialExpiresAt: credentialExpiry(source.expires_at ?? source.expiresAt ?? source.expired ?? source.expires ?? accessClaims.exp),
      credentialAccount: text(source.email, user.email, idClaims.email, accessClaims.email,
        account.email, account.emailAddress, account.email_address, account.username, source.username, source.name, user.name),
      credentialAccountId: text(source.account_id, source.accountId, source.chatgpt_account_id, auth.chatgpt_account_id, account.id, account.uuid),
      credentialProvider: text(source.provider, source.type),
      credentialPlan: text(source.plan_type, source.planType, source.subscription_tier, source.subscriptionTier,
        source.entitlement_status, auth.chatgpt_plan_type, account.planType, account.plan,
        account.subscription_tier, account.subscriptionTier),
      credentialSubscriptionExpiresAt: credentialExpiry(source.subscription_expires_at ?? source.subscriptionExpiresAt ??
        source.subscription_expires ?? source.subscriptionExpiry)
    }
  };
}

export function credentialExpiry(value: unknown): string | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d+)?$/u.test(value) ? Number(value) : null;
  const millis = numeric !== null ? (numeric > 100_000_000_000 ? numeric : numeric * 1000) : typeof value === "string" ? Date.parse(value) : NaN;
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalize(value: unknown, depth = 0): JsonRecord {
  if (depth > 8) throw new Error("凭据 JSON 嵌套层数过多。");
  if (typeof value === "string") {
    const raw = value.trim();
    if (["[", "{", '"'].includes(raw[0] ?? "")) {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw new Error("凭据 JSON 格式无效。"); }
      return normalize(parsed, depth + 1);
    }
    return { access_token: raw };
  }
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error("每个供应商配置保存一个账号，请将多个账号分别导入不同配置。");
    return normalize(value[0], depth + 1);
  }
  if (!value || typeof value !== "object") throw new Error("凭据必须是 JSON 对象或 Token 字符串。");
  const source = value as JsonRecord;
  if (Array.isArray(source.accounts)) return normalize(source.accounts, depth + 1);
  for (const key of ["session", "session_json", "token_data", "tokens", "token", "credential", "credentials", "claudeAiOauth"]) {
    const child = source[key];
    if (child && typeof child === "object" || typeof child === "string" && /^[\[{]/u.test(child.trim())) {
      return { ...source, ...normalize(child, depth + 1) };
    }
  }
  return source;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function jwtClaims(value: string | null): JsonRecord {
  if (!value || value.length > 128 * 1024) return {};
  const parts = value.split(".");
  if (parts.length !== 3) return {};
  try { return record(JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"))); } catch { return {}; }
}

function text(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}
