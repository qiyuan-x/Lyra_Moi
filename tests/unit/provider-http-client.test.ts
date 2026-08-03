import { describe, expect, it } from "vitest";
import {
  ProviderConnectionError,
  ProviderHttpClient,
  type FetchLike
} from "@lyra/providers";

describe("ProviderHttpClient", () => {
  it.each([
    [400, "BAD_REQUEST"],
    [401, "AUTHENTICATION_FAILED"],
    [403, "PERMISSION_DENIED"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [500, "SERVER_ERROR"]
  ] as const)("maps HTTP %s to %s", async (status, code) => {
    const client = new ProviderHttpClient({
      fetchImplementation: async () =>
        new Response("error", {
          status,
          headers: { "x-request-id": "request-1" }
        })
    });
    const error = await client.getJson("https://provider.test", {}).catch((value) => value);
    expect(error).toBeInstanceOf(ProviderConnectionError);
    expect(error).toMatchObject({ code, statusCode: status, requestId: "request-1" });
  });

  it("rejects responses above the configured limit", async () => {
    const client = new ProviderHttpClient({
      maxResponseBytes: 4,
      fetchImplementation: async () => new Response("12345")
    });
    await expect(client.getBinary("https://provider.test")).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE"
    });
  });

  it("keeps a short provider error message for troubleshooting", async () => {
    const client = new ProviderHttpClient({
      fetchImplementation: async () =>
        Response.json(
          { error: { message: "No available accounts for this model." } },
          { status: 503 }
        )
    });
    await expect(
      client.getJson("https://provider.test", {})
    ).rejects.toMatchObject({
      code: "SERVER_ERROR",
      message: "Provider returned HTTP 503: No available accounts for this model."
    });
  });

  it("distinguishes timeout from caller cancellation", async () => {
    const fetchImplementation: FetchLike = async (_input, init = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    const timeoutClient = new ProviderHttpClient({ timeoutMs: 10, fetchImplementation });
    await expect(timeoutClient.getJson("https://provider.test", {})).rejects.toMatchObject({
      code: "TIMEOUT"
    });

    const controller = new AbortController();
    const callerClient = new ProviderHttpClient({ timeoutMs: 1_000, fetchImplementation });
    const request = callerClient.getJson("https://provider.test", {}, controller.signal);
    const reason = new Error("caller stopped");
    controller.abort(reason);
    await expect(request).rejects.toBe(reason);
  });
});
