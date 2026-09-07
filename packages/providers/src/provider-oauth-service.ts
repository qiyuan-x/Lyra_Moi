import { systemProxyFetch } from "./system-proxy.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { CODEX_OAUTH_SETTINGS, providerOAuthSettings } from "@lyra/contracts";
import type { ProviderRepository, SecretStore, StoredProviderProfile } from "@lyra/storage";
import { credentialExpiry, parseImportedCredential, type ImportedCredential } from "./imported-credential.js";
import { withProviderCredentialLock } from "./provider-credential-lock.js";
import { createSecondaryApiKeyEnvironmentVariable } from "./provider-settings-service.js";
import { ProviderHttpClient } from "./provider-http-client.js";

interface Pending {
  profileId: string;
  verifier: string;
  expiresAt: number;
  redirectUri: string;
  settings: Record<string, unknown>;
}

export class ProviderOAuthService {
  private readonly pending = new Map<string, Pending>();
  private readonly completing = new Set<string>();
  private readonly completed = new Map<string, { profileId: string; expiresAt: number }>();
  private callbackServer: Server | null = null;
  private callbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly providers: ProviderRepository,
    private readonly secrets: SecretStore,
    private readonly fetchImplementation: typeof fetch = systemProxyFetch
  ) {}

  start(profileId: string, redirectUri: string): { state: string; authorizationUrl: string } {
    for (const [key, item] of this.completed) if (item.expiresAt < Date.now()) this.completed.delete(key);
    const settings = providerOAuthSettings(this.providers.requireProfile(profileId));
    const authorize = readUrl(settings.oauthAuthorizeUrl);
    const clientId = readText(settings.oauthClientId);
    if (!authorize || !clientId || !readUrl(settings.oauthTokenUrl)) {
      throw new Error("该供应商未配置 OAuth 授权地址、Token 地址或 Client ID。");
    }
    const redirect = new URL(readText(settings.oauthRedirectUri) ?? redirectUri);
    if (!/^https?:$/u.test(redirect.protocol)) throw new Error("OAuth 回调地址无效。");
    for (const [key, item] of this.pending) {
      if (item.expiresAt < Date.now() || item.profileId === profileId) this.pending.delete(key);
    }
    const state = randomUUID();
    const verifier = randomBytes(32).toString("base64url");
    this.pending.set(state, { profileId, verifier, expiresAt: Date.now() + 10 * 60_000, redirectUri: redirect.toString(), settings });
    // Cockpit Tools completes Codex/Gemini OAuth through the standard local
    // callback. Keep the manual paste fallback, but also listen on the
    // registered port when it is available.
    if (redirect.hostname === "localhost" && redirect.port === "1455" && process.env.NODE_ENV !== "test") {
      this.startLocalCallbackServer();
    }
    const url = new URL(authorize);
    const parameters = {
      response_type: "code", client_id: clientId, redirect_uri: redirect.toString(), state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256"
    };
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    const scope = readText(settings.oauthScope);
    if (scope) url.searchParams.set("scope", scope);
    if (authorize.startsWith("https://claude.com/") || authorize.startsWith("https://claude.ai/")) url.searchParams.set("code", "true");
    const originator = readText(settings.oauthOriginator);
    if (originator) url.searchParams.set("originator", originator);
    if (clientId === CODEX_OAUTH_SETTINGS.oauthClientId && authorize === CODEX_OAUTH_SETTINGS.oauthAuthorizeUrl) {
      url.searchParams.set("id_token_add_organizations", "true");
      url.searchParams.set("codex_cli_simplified_flow", "true");
    }
    return { state, authorizationUrl: url.toString() };
  }

  cancel(profileId: string): void {
    for (const [state, item] of this.pending) if (item.profileId === profileId) this.pending.delete(state);
    if (!this.pending.size) this.stopLocalCallbackServer();
  }

  completedProfile(state: string, profileId: string): string | null {
    const item = this.completed.get(state);
    return item && item.profileId === profileId && item.expiresAt > Date.now() ? profileId : null;
  }

  close(): void {
    this.pending.clear();
    this.stopLocalCallbackServer();
  }

  private startLocalCallbackServer(): void {
    if (this.callbackServer) return;
    const server = createServer((request, response) => {
      if (request.method !== "GET" || !request.url?.startsWith("/auth/callback")) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not Found");
        return;
      }
      const url = new URL(request.url, "http://localhost:1455");
      const state = url.searchParams.get("state")?.trim() ?? "";
      const code = url.searchParams.get("code")?.trim() ?? "";
      if (!state || !code) {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end("<h3>Lyra OAuth callback is missing code or state.</h3>");
        return;
      }
      void this.callback(state, code).then(() => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<h3>Lyra 授权成功</h3><p>凭据已保存，应用会自动刷新账号状态。可以返回应用并关闭此页，无需再粘贴回调地址。</p>");
      }).catch((error: unknown) => {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end(`<h3>Lyra 授权失败</h3><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`);
      }).finally(() => this.stopLocalCallbackServer());
    });
    server.once("error", () => {
      // Another Codex/Cockpit instance may own the registered callback port.
      // The UI's copy/paste callback remains available in that case.
      this.stopLocalCallbackServer();
    });
    this.callbackServer = server;
    this.callbackTimer = setTimeout(() => this.stopLocalCallbackServer(), 10 * 60_000);
    this.callbackTimer.unref();
    server.listen(1455, "127.0.0.1");
    server.unref();
  }

  private stopLocalCallbackServer(): void {
    if (this.callbackTimer) clearTimeout(this.callbackTimer);
    this.callbackTimer = null;
    const server = this.callbackServer;
    this.callbackServer = null;
    if (server) server.close();
  }

  async callback(state: string, code: string, expectedProfileId?: string): Promise<StoredProviderProfile> {
    const item = this.pending.get(state);
    if (!item || item.expiresAt < Date.now()) throw new Error("OAuth 授权状态已过期或无效。");
    if (expectedProfileId && item.profileId !== expectedProfileId) throw new Error("OAuth 授权状态与供应商不匹配。");
    if (!code.trim()) throw new Error("OAuth 回调缺少授权码。");
    if (this.completing.has(state)) throw new Error("OAuth 授权正在处理中。");
    this.completing.add(state);
    try {
      const profile = this.providers.requireProfile(item.profileId);
      // Exchange against the exact configuration that created the PKCE session.
      const settings = item.settings;
      const form: Record<string, string> = {
        grant_type: "authorization_code", code, client_id: String(settings.oauthClientId),
        redirect_uri: item.redirectUri, code_verifier: item.verifier
      };
      let clientSecret = readText(settings.oauthClientSecret);
      // Gemini CLI/Code Assist and AI Studio clients both require a client
      // secret at token exchange. Keep it in the .env-backed SecretStore;
      // never copy it into profile settings or API responses.
      if (!clientSecret && profile.adapterType === "gemini") {
        const customSecretKey = readText(settings.oauthClientSecretEnvironmentVariable);
        const mode = readText(settings.oauthType) ?? "code_assist";
        const keys = customSecretKey
          ? [customSecretKey]
          : mode === "code_assist" || mode === "google_one"
            ? ["GEMINI_CLI_OAUTH_CLIENT_SECRET", "GEMINI_OAUTH_CLIENT_SECRET"]
            : ["GEMINI_OAUTH_CLIENT_SECRET"];
        for (const key of keys) {
          clientSecret = await this.secrets.get(key);
          if (clientSecret) break;
        }
      }
      if (clientSecret) form.client_secret = clientSecret;
      const http = new ProviderHttpClient({ fetchImplementation: this.fetchImplementation, timeoutMs: 30_000, maxResponseBytes: 256 * 1024 });
      const value = await http.requestJson(String(settings.oauthTokenUrl), {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(form)
      }) as Record<string, unknown>;
      const credential = parseImportedCredential({ ...value, mode: "oauth", expires_at: expiryFromToken(value) });
      return await withProviderCredentialLock(item.profileId, async () => {
        if (this.pending.get(state) !== item) throw new Error("OAuth 授权已取消，请重新开始。");
        const profile = await this.saveCredential(item.profileId, credential);
        this.completed.set(state, { profileId: item.profileId, expiresAt: Date.now() + 10 * 60_000 });
        return profile;
      });
    } finally {
      this.pending.delete(state);
      this.completing.delete(state);
    }
  }

  private async saveCredential(profileId: string, credential: ImportedCredential): Promise<StoredProviderProfile> {
    let profile = this.providers.requireProfile(profileId);
    if (credential.refreshToken && !profile.secondaryApiKeyEnvironmentVariable) {
      profile = this.providers.updateProfile(profileId, { secondaryApiKeyEnvironmentVariable: createSecondaryApiKeyEnvironmentVariable(profileId) });
    }
    const primary = profile.apiKeyEnvironmentVariable;
    const secondary = profile.secondaryApiKeyEnvironmentVariable;
    const previousAccess = await this.secrets.get(primary);
    const previousRefresh = secondary ? await this.secrets.get(secondary) : null;
    try {
      await this.secrets.set(primary, credential.accessToken);
      if (secondary) await this.restoreSecret(secondary, credential.refreshToken);
      return this.providers.updateProfile(profileId, { settings: { ...profile.settings, ...credential.settings } });
    } catch (error) {
      await this.restoreSecret(primary, previousAccess);
      if (secondary) await this.restoreSecret(secondary, previousRefresh);
      throw error;
    }
  }

  private async restoreSecret(key: string, value: string | null): Promise<void> {
    if (value) await this.secrets.set(key, value);
    else await this.secrets.delete(key);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] ?? character);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function readUrl(value: unknown): string | null {
  const text = readText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return /^https?:$/u.test(url.protocol) ? url.toString() : null;
  } catch { return null; }
}
function expiryFromToken(value: Record<string, unknown>): string | null {
  const relative = value.expires_in ?? value.expiresIn;
  if (typeof relative === "number" && Number.isFinite(relative)) return credentialExpiry(Date.now() + relative * 1000);
  return credentialExpiry(value.expires_at ?? value.expiresAt);
}
