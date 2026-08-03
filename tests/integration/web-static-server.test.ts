import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
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
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("web static server", () => {
  it("serves built assets and falls back to index.html for browser routes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lyra-web-static-"));
    temporaryDirectories.push(directory);
    const webRoot = join(directory, "web");
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await writeFile(join(webRoot, "index.html"), "<main>Lyra shell</main>", "utf8");
    await writeFile(join(webRoot, "assets", "app.css"), "body{color:black}", "utf8");
    await writeFile(join(directory, "secret.txt"), "must-not-be-served", "utf8");

    const database = new LyraDatabase(join(directory, "lyra.sqlite3"));
    prepareM4Database(database);
    const server = createApiServer({
      events: new RuntimeEventFeed(new RuntimeEventRepository(database)),
      webRoot
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const asset = await fetch(`${baseUrl}/assets/app.css`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toContain("text/css");
      expect(await asset.text()).toBe("body{color:black}");

      const browserRoute = await fetch(`${baseUrl}/workspace/conversation-1`);
      expect(browserRoute.status).toBe(200);
      expect(await browserRoute.text()).toContain("Lyra shell");

      const traversal = await fetch(`${baseUrl}/%2e%2e%2fsecret.txt`);
      expect(await traversal.text()).not.toContain("must-not-be-served");

      const apiRoute = await fetch(`${baseUrl}/api/unknown`);
      expect(apiRoute.status).toBe(404);
      expect(apiRoute.headers.get("content-type")).toContain("application/json");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      database.close();
    }
  });
});
