import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EnvironmentFileSecretStore,
  parseEnvironmentFile
} from "@lyra/storage";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("EnvironmentFileSecretStore", () => {
  it("serializes concurrent writes and supports explicit deletion", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-secrets-"));
    temporaryDirectories.push(parent);
    const file = join(parent, "data", "config", ".env");
    const store = new EnvironmentFileSecretStore(file);

    await Promise.all([
      store.set("LYRA_PROVIDER_A_API_KEY", "first-secret"),
      store.set("LYRA_PROVIDER_B_API_KEY", "value with \"quotes\"\nand newline")
    ]);

    expect(await store.get("LYRA_PROVIDER_A_API_KEY")).toBe("first-secret");
    expect(await store.get("LYRA_PROVIDER_B_API_KEY")).toBe(
      "value with \"quotes\"\nand newline"
    );
    await store.delete("LYRA_PROVIDER_A_API_KEY");
    expect(await store.has("LYRA_PROVIDER_A_API_KEY")).toBe(false);

    const content = await readFile(file, "utf8");
    expect(content).not.toContain("first-secret");
    expect(parseEnvironmentFile(content).get("LYRA_PROVIDER_B_API_KEY")).toBe(
      "value with \"quotes\"\nand newline"
    );
  });

  it("rejects invalid environment variable names without exposing values", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-secrets-"));
    temporaryDirectories.push(parent);
    const store = new EnvironmentFileSecretStore(join(parent, ".env"));
    const secret = "must-not-appear";

    await expect(store.set("bad-key", secret)).rejects.not.toThrow(secret);
  });
});
