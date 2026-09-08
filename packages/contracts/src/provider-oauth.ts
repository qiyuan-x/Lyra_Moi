import type { ProviderProfileSnapshot } from "./provider.js";

export const ANTIGRAVITY_OAUTH_SETTINGS = {
  antigravity: true,
  oauthAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  oauthTokenUrl: "https://oauth2.googleapis.com/token",
  oauthClientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  oauthScope: "openid https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs",
  oauthRedirectUri: "http://localhost:1455/auth/callback",
  oauthClientSecretEnvironmentVariable: "ANTIGRAVITY_OAUTH_CLIENT_SECRET"
};

// Public Codex desktop OAuth client parameters, as used by Cockpit Tools.
export const CODEX_OAUTH_SETTINGS = {
  oauthAuthorizeUrl: "https://auth.openai.com/oauth/authorize",
  oauthTokenUrl: "https://auth.openai.com/oauth/token",
  oauthClientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  oauthScope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
  oauthOriginator: "Codex Desktop",
  oauthRedirectUri: "http://localhost:1455/auth/callback"
};

// Public OAuth endpoints used by the upstream clients. Client secrets are not
// embedded here; providers that require one can supply it through advanced
// profile settings or use API Key authentication.
export const ANTHROPIC_OAUTH_SETTINGS = {
  oauthAuthorizeUrl: "https://claude.com/cai/oauth/authorize",
  oauthTokenUrl: "https://platform.claude.com/v1/oauth/token",
  oauthClientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  oauthScope: "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
  oauthRedirectUri: "https://platform.claude.com/oauth/code/callback"
};

export const GEMINI_OAUTH_SETTINGS = {
  oauthAuthorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  oauthTokenUrl: "https://oauth2.googleapis.com/token",
  oauthClientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
  oauthScope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
  oauthRedirectUri: "http://localhost:1455/auth/callback"
};

export function providerOAuthSettings(
  profile: Pick<ProviderProfileSnapshot, "settings" | "baseUrl" | "serviceType" | "adapterType">
): Record<string, unknown> {
  const settings = { ...profile.settings };
  let official = false;
  try { official = new URL(profile.baseUrl).origin === "https://api.openai.com"; } catch { /* Custom URL is validated on save. */ }
  if (profile.serviceType !== "llm" && settings.antigravity !== true) return settings;
  // These presets mirror the provider CLI flows. They are only defaults:
  // explicit profile values always win and custom endpoints stay untouched.
  const preset = settings.antigravity === true ? ANTIGRAVITY_OAUTH_SETTINGS : profile.adapterType === "anthropic"
    ? ANTHROPIC_OAUTH_SETTINGS
    : profile.adapterType === "gemini"
      ? GEMINI_OAUTH_SETTINGS
      : profile.adapterType === "openai" && official
        ? CODEX_OAUTH_SETTINGS
        : null;
  if (!preset) return settings;
  // Never replace custom OAuth client parameters with Codex defaults.
  if (typeof settings.oauthAuthorizeUrl === "string" && settings.oauthAuthorizeUrl.trim() && settings.oauthAuthorizeUrl !== preset.oauthAuthorizeUrl) return settings;
  if (typeof settings.oauthClientId === "string" && settings.oauthClientId.trim() && settings.oauthClientId !== preset.oauthClientId) return settings;
  for (const [key, value] of Object.entries(preset)) {
    if (typeof settings[key] !== "string" || !settings[key].trim()) settings[key] = value;
  }
  return settings;
}
