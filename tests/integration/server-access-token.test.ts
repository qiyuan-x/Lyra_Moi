import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApiServer } from "@lyra/api";
import { RuntimeEventFeed } from "@lyra/core";
import {
  RuntimeEventRepository,
  createRuntimeLayout,
  migrateRuntimeDatabase,
  openReadyRuntimeDatabase
} from "@lyra/storage";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("server access token", () => {
  it("keeps health public and rejects unauthenticated business requests", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-server-auth-"));
    temporaryDirectories.push(parent);
    const layout = createRuntimeLayout(join(parent, "data"));
    await migrateRuntimeDatabase(layout);
    const database = await openReadyRuntimeDatabase(layout);
    const server = createApiServer({
      events: new RuntimeEventFeed(new RuntimeEventRepository(database)),
      accessToken: "server-secret"
    });

    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(0, "127.0.0.1", resolveListen);
      });
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      expect((await fetch(`${baseUrl}/api/v1/health/live`)).status).toBe(200);
      const unauthorized = await fetch(`${baseUrl}/api/v1/providers`);
      expect(unauthorized.status).toBe(401);
      expect(await unauthorized.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });

      const authorized = await fetch(`${baseUrl}/api/v1/providers`, {
        headers: { Authorization: "Bearer server-secret" }
      });
      expect(authorized.status).toBe(503);
      const queryAuthorized = await fetch(
        `${baseUrl}/api/v1/providers?access_token=server-secret`
      );
      expect(queryAuthorized.status).toBe(503);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      database.close();
    }
  });
});
