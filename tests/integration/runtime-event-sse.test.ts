import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApiServer } from "@lyra/api";
import { RuntimeEventFeed } from "@lyra/core";
import { LyraDatabase, RuntimeEventRepository } from "@lyra/storage";
import { prepareM4Database } from "../fixtures/m4-database.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("runtime event SSE", () => {
  it("resumes after query and Last-Event-ID cursors without replaying older events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lyra-sse-"));
    temporaryDirectories.push(directory);
    const database = new LyraDatabase(join(directory, "lyra.sqlite3"));
    const seed = prepareM4Database(database);
    const events = new RuntimeEventRepository(database);
    const first = events.append({ projectId: seed.projectId, type: "test.first", payload: { n: 1 } });
    const second = events.append({ projectId: seed.projectId, type: "test.second", payload: { n: 2 } });
    const server = createApiServer({
      events: new RuntimeEventFeed(events),
      eventPollIntervalMs: 10,
      heartbeatIntervalMs: 1_000
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}/api/v1/events?projectId=${seed.projectId}`;

      const queryResume = await readOneEvent(`${baseUrl}&afterEventId=${first.id}`);
      expect(queryResume).toContain(`id: ${second.id}`);
      expect(queryResume).toContain("event: test.second");
      expect(queryResume).not.toContain(`id: ${first.id}\n`);

      const third = events.append({ projectId: seed.projectId, type: "test.third", payload: { n: 3 } });
      const headerResume = await readOneEvent(baseUrl, { "Last-Event-ID": String(second.id) });
      expect(headerResume).toContain(`id: ${third.id}`);
      expect(headerResume).toContain("event: test.third");
      expect(headerResume).not.toContain("event: test.second");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
    }
  });
});

async function readOneEvent(url: string, headers?: Record<string, string>): Promise<string> {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE response body is missing.");
  const decoder = new TextDecoder();
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value, { stream: true });
      const blocks = body.split("\n\n");
      const eventBlock = blocks.find((block) => block.startsWith("id: "));
      if (eventBlock) return `${eventBlock}\n\n`;
    }
    throw new Error("SSE stream closed before an event was received.");
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
}
