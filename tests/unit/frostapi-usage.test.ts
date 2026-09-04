import { describe, expect, it } from "vitest";
import {
  FrostApiUsageClient,
  ProviderConnectionError,
  ProviderHttpClient,
  buildFrostApiUsageUrl,
  parseFrostApiUsage
} from "@lyra/providers";

describe("FrostAPI usage", () => {
  it("queries wallet balance with bearer authentication", async () => {
    let requestUrl = "";
    let requestHeaders = new Headers();
    const client = new FrostApiUsageClient(new ProviderHttpClient({
      fetchImplementation: async (input, init) => {
        requestUrl = String(input);
        requestHeaders = new Headers(init?.headers);
        return Response.json({
          mode: "unrestricted",
          planName: "钱包余额",
          balance: 5,
          remaining: 5,
          unit: "USD"
        });
      }
    }));

    await expect(client.query({
      baseUrl: "https://api.linfrsot.cloud/v1",
      apiKey: "sk-test"
    })).resolves.toEqual({
      mode: "unrestricted",
      planName: "钱包余额",
      balance: 5,
      remaining: 5,
      unit: "USD"
    });
    expect(requestUrl).toBe("https://api.linfrsot.cloud/v1/usage");
    expect(requestHeaders.get("authorization")).toBe("Bearer sk-test");
  });

  it("parses API-key quota usage", () => {
    expect(parseFrostApiUsage({
      mode: "quota_limited",
      quota: { limit: 10, used: 3, remaining: 7, unit: "USD" }
    })).toEqual({
      mode: "quota_limited",
      quota: { limit: 10, used: 3, remaining: 7, unit: "USD" }
    });
  });

  it("normalizes root and versioned usage URLs", () => {
    expect(buildFrostApiUsageUrl("https://api.linfrsot.cloud"))
      .toBe("https://api.linfrsot.cloud/v1/usage");
    expect(buildFrostApiUsageUrl("https://gateway.test/openai/v1/"))
      .toBe("https://gateway.test/openai/v1/usage");
  });

  it("rejects missing keys and invalid response modes", async () => {
    const client = new FrostApiUsageClient(new ProviderHttpClient({
      fetchImplementation: async () => Response.json({ mode: "unknown" })
    }));
    await expect(client.query({ baseUrl: "https://api.test", apiKey: null }))
      .rejects.toMatchObject({ code: "MISSING_API_KEY" });
    expect(() => parseFrostApiUsage({ mode: "unknown" }))
      .toThrow(ProviderConnectionError);
  });
});
