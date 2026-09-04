import type { FrostApiUsageSnapshot } from "@lyra/contracts";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";

export interface FrostApiUsageInput {
  baseUrl: string;
  apiKey: string | null;
  signal?: AbortSignal;
}

export interface FrostApiUsageReader {
  query(input: FrostApiUsageInput): Promise<FrostApiUsageSnapshot>;
}

export class FrostApiUsageClient implements FrostApiUsageReader {
  readonly #client: ProviderHttpClient;

  constructor(client = new ProviderHttpClient({ timeoutMs: 15_000, maxResponseBytes: 64 * 1024 })) {
    this.#client = client;
  }

  async query(input: FrostApiUsageInput): Promise<FrostApiUsageSnapshot> {
    const apiKey = input.apiKey?.trim();
    if (!apiKey) {
      throw new ProviderConnectionError(
        "MISSING_API_KEY",
        "FrostAPI API key is not configured."
      );
    }
    const body = await this.#client.getJson(
      buildFrostApiUsageUrl(input.baseUrl),
      {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      input.signal
    );
    return parseFrostApiUsage(body);
  }
}

export function buildFrostApiUsageUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/u, "");
  url.pathname = /\/v1$/u.test(path) ? `${path}/usage` : `${path}/v1/usage`;
  return url.toString();
}

export function parseFrostApiUsage(value: unknown): FrostApiUsageSnapshot {
  const body = requireRecord(value, "FrostAPI returned an invalid usage response.");
  if (body.mode === "unrestricted") {
    return {
      mode: "unrestricted",
      planName: requireText(body.planName, "FrostAPI usage plan name is missing."),
      balance: requireNumber(body.balance, "FrostAPI balance is invalid."),
      remaining: requireNumber(body.remaining, "FrostAPI remaining balance is invalid."),
      unit: requireText(body.unit, "FrostAPI usage unit is missing.")
    };
  }
  if (body.mode === "quota_limited") {
    const quota = requireRecord(body.quota, "FrostAPI quota information is missing.");
    return {
      mode: "quota_limited",
      quota: {
        limit: requireNumber(quota.limit, "FrostAPI quota limit is invalid."),
        used: requireNumber(quota.used, "FrostAPI quota usage is invalid."),
        remaining: requireNumber(quota.remaining, "FrostAPI quota remaining is invalid."),
        unit: requireText(quota.unit, "FrostAPI quota unit is missing.")
      }
    };
  }
  throw new ProviderConnectionError(
    "INVALID_RESPONSE",
    "FrostAPI returned an unsupported usage mode."
  );
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderConnectionError("INVALID_RESPONSE", message);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProviderConnectionError("INVALID_RESPONSE", message);
  }
  return value.trim();
}

function requireNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProviderConnectionError("INVALID_RESPONSE", message);
  }
  return value;
}
