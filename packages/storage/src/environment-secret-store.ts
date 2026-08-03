import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const ENVIRONMENT_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export interface SecretStore {
  get(key: string): Promise<string | null>;
  has(key: string): Promise<boolean>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class EnvironmentFileSecretStore implements SecretStore {
  readonly path: string;
  #mutationQueue: Promise<void> = Promise.resolve();

  constructor(environmentFilePath: string) {
    this.path = resolve(environmentFilePath);
  }

  async get(key: string): Promise<string | null> {
    validateKey(key);
    await this.#mutationQueue;
    return (await this.#readAll()).get(key) ?? null;
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async set(key: string, value: string): Promise<void> {
    validateKey(key);
    if (!value) throw new Error("Secret value cannot be empty.");
    await this.#mutate(async () => {
      const values = await this.#readAll();
      values.set(key, value);
      await this.#writeAll(values);
    });
  }

  async delete(key: string): Promise<void> {
    validateKey(key);
    await this.#mutate(async () => {
      const values = await this.#readAll();
      if (!values.delete(key)) return;
      await this.#writeAll(values);
    });
  }

  async #mutate(operation: () => Promise<void>): Promise<void> {
    const current = this.#mutationQueue.then(operation, operation);
    this.#mutationQueue = current.catch(() => undefined);
    await current;
  }

  async #readAll(): Promise<Map<string, string>> {
    let content: string;
    try {
      content = await readFile(this.path, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) return new Map();
      throw error;
    }
    return parseEnvironmentFile(content);
  }

  async #writeAll(values: ReadonlyMap<string, string>): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true });
    const temporaryPath = join(
      directory,
      `.${basename(this.path)}.${process.pid}.${randomUUID()}.tmp`
    );
    const content = serializeEnvironmentFile(values);
    try {
      await writeFile(temporaryPath, content, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      await rename(temporaryPath, this.path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

export function parseEnvironmentFile(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const sourceLine of content.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const separator = normalized.indexOf("=");
    if (separator < 1) continue;
    const key = normalized.slice(0, separator).trim();
    if (!ENVIRONMENT_KEY_PATTERN.test(key)) continue;
    const sourceValue = normalized.slice(separator + 1).trim();
    values.set(key, parseEnvironmentValue(sourceValue));
  }
  return values;
}

export function serializeEnvironmentFile(values: ReadonlyMap<string, string>): string {
  const lines = [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      validateKey(key);
      return `${key}=${JSON.stringify(value)}`;
    });
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function parseEnvironmentValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function validateKey(key: string): void {
  if (!ENVIRONMENT_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid environment variable name: ${key}`);
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
