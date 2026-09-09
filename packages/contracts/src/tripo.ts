export const TRIPO_BASE_URL = "https://openapi.tripo3d.com/v3";

export const TRIPO_REGIONS = {
  international: { label: "国际站", baseUrl: "https://openapi.tripo3d.ai/v3", keyWebsite: "https://developers.tripo3d.ai/zh/keys" },
  china: { label: "国内站", baseUrl: TRIPO_BASE_URL, keyWebsite: "https://developers.tripo3d.com/zh/keys" }
} as const;

export function tripoRegion(baseUrl: string): keyof typeof TRIPO_REGIONS | "custom" {
  try {
    const normalized = normalizeTripoBaseUrl(baseUrl);
    if (normalized === TRIPO_REGIONS.international.baseUrl) return "international";
    if (normalized === TRIPO_REGIONS.china.baseUrl) return "china";
  } catch { /* An incomplete URL remains editable as a custom address. */ }
  return "custom";
}

/** Upgrade official endpoints only; custom gateways keep their configured protocol. */
export function normalizeTripoBaseUrl(value: string): string {
  const base = value.trim().replace(/\/+$/u, "");
  const url = new URL(base);
  if (url.protocol === "https:" && !url.port && !url.search && !url.hash &&
      /^(api|openapi)\.tripo3d\.(ai|com)$/u.test(url.hostname) &&
      ["", "/", "/v2/openapi", "/v3"].includes(url.pathname)) {
    return `https://openapi.tripo3d.${url.hostname.endsWith(".com") ? "com" : "ai"}/v3`;
  }
  return base;
}

export function tripoModelFamily(model: string): "p1" | "p2" | "h3" | "h2" {
  if (/^(P1-|tripo-p1$)/u.test(model)) return "p1";
  if (/^(P2-|tripo-p2$)/u.test(model)) return "p2";
  return /^(v3\.|tripo-v3\.)/u.test(model) ? "h3" : "h2";
}

export function tripoFaceRange(model: string, values: Record<string, unknown>) {
  const family = tripoModelFamily(model);
  if (family === "p1") return { minimum: 50, maximum: 20_000 };
  if (family === "p2") return { minimum: 48, maximum: values.quad === true ? 25_000 : 50_000 };
  if (values.smartLowPoly === true) return { minimum: 500, maximum: values.quad === true ? 10_000 : 20_000 };
  if (values.quad === true) return { minimum: 1_000, maximum: 150_000 };
  if (family === "h2") return { minimum: 1_000, maximum: 500_000 };
  return { minimum: 1_000, maximum: values.geometryQuality === "detailed" ? 2_000_000 :
    /^(v3\.0|tripo-v3\.0)/u.test(model) ? 1_000_000 : 1_500_000 };
}
