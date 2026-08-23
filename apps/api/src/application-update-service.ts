import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  ApplicationUpdateArtifact,
  ApplicationUpdateManifest,
  ApplicationUpdatePlatform,
  ApplicationUpdateSnapshot
} from "@lyra/contracts";
import { APPLICATION_UPDATE_PLATFORM } from "@lyra/contracts";

interface StoredUpdateState {
  schemaVersion: 1;
  snapshot: ApplicationUpdateSnapshot;
  candidate?: {
    version: string;
    artifact: ApplicationUpdateArtifact;
  };
}

interface UpdateRequest {
  schemaVersion: 1;
  baseDir: string;
  currentVersion: string;
  targetVersion: string;
  platform: ApplicationUpdatePlatform;
  artifact: ApplicationUpdateArtifact;
  stateFile: string;
  port: number;
}

export interface ApplicationUpdateServiceOptions {
  currentVersion: string;
  baseDirectory: string;
  stateFile: string;
  requestFile: string;
  manifestUrl?: string;
  helperCommand?: string[];
  deploymentMode?: string;
  fetchManifest?: (url: string) => Promise<unknown>;
  launchHelper?: (command: readonly string[], requestFile: string) => void;
  launchDelayMs?: number;
  port?: number;
}

export class ApplicationUpdateService {
  private readonly currentVersion: string;
  private readonly baseDirectory: string;
  private readonly stateFile: string;
  private readonly requestFile: string;
  private readonly manifestUrl: string | undefined;
  private readonly helperCommand: readonly string[];
  private readonly fetchManifest: (url: string) => Promise<unknown>;
  private readonly launchHelper: (command: readonly string[], requestFile: string) => void;
  private readonly launchDelayMs: number;
  private readonly enabled: boolean;
  private readonly port: number;
  private operation: Promise<ApplicationUpdateSnapshot> | undefined;

  constructor(options: ApplicationUpdateServiceOptions) {
    this.currentVersion = requireVersion(options.currentVersion, "Current version");
    this.baseDirectory = resolve(options.baseDirectory);
    this.stateFile = resolve(options.stateFile);
    this.requestFile = resolve(options.requestFile);
    this.manifestUrl = options.manifestUrl?.trim() || undefined;
    this.helperCommand = (options.helperCommand ?? []).map((item) => item.trim()).filter(Boolean);
    this.fetchManifest = options.fetchManifest ?? fetchManifest;
    this.launchHelper = options.launchHelper ?? launchDetachedHelper;
    this.launchDelayMs = options.launchDelayMs ?? 750;
    this.port = options.port ?? 3000;
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65_535) {
      throw new Error("Application update port is invalid.");
    }
    this.enabled =
      (options.deploymentMode?.trim() || "development") === "desktop" &&
      Boolean(this.manifestUrl) &&
      this.helperCommand.length > 0;
  }

  async snapshot(): Promise<ApplicationUpdateSnapshot> {
    const state = await this.readState();
    return state.snapshot;
  }

  async check(): Promise<ApplicationUpdateSnapshot> {
    if (!this.enabled) return this.defaultSnapshot();
    if (this.operation) return this.operation;
    this.operation = this.performCheck().finally(() => {
      this.operation = undefined;
    });
    return this.operation;
  }

  async apply(): Promise<ApplicationUpdateSnapshot> {
    if (!this.enabled) throw new Error("Automatic updates are not configured.");
    const state = await this.readState();
    if (state.snapshot.status !== "available" || !state.candidate) {
      throw new Error("No checked application update is available.");
    }
    const request: UpdateRequest = {
      schemaVersion: 1,
      baseDir: this.baseDirectory,
      currentVersion: this.currentVersion,
      targetVersion: state.candidate.version,
      platform: APPLICATION_UPDATE_PLATFORM,
      artifact: state.candidate.artifact,
      stateFile: this.stateFile,
      port: this.port
    };
    await writeJsonAtomic(this.requestFile, request);
    const scheduled: StoredUpdateState = {
      ...state,
      snapshot: {
        ...state.snapshot,
        status: "scheduled",
        progress: 0,
        message: "升级任务已提交，正在启动更新程序。"
      }
    };
    await this.writeState(scheduled);
    const timer = setTimeout(() => {
      try {
        this.launchHelper(this.helperCommand, this.requestFile);
      } catch (error) {
        void this.writeState({
          schemaVersion: 1,
          snapshot: {
            ...scheduled.snapshot,
            status: "failed",
            progress: null,
            message: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }, this.launchDelayMs);
    timer.unref();
    return scheduled.snapshot;
  }

  private async performCheck(): Promise<ApplicationUpdateSnapshot> {
    const previous = await this.readState();
    await this.writeState({
      ...previous,
      snapshot: {
        ...previous.snapshot,
        status: "checking",
        progress: null,
        message: "正在检查新版本。"
      }
    });
    try {
      const manifest = parseManifest(await this.fetchManifest(this.manifestUrl!));
      const artifact = manifest.artifacts[APPLICATION_UPDATE_PLATFORM];
      const available = compareVersions(manifest.version, this.currentVersion) > 0;
      const snapshot: ApplicationUpdateSnapshot = {
        enabled: true,
        currentVersion: this.currentVersion,
        latestVersion: manifest.version,
        platform: APPLICATION_UPDATE_PLATFORM,
        updateAvailable: available,
        status: available ? "available" : "current",
        progress: null,
        message: available ? "发现新版本。" : "已是最新版本。",
        checkedAt: new Date().toISOString(),
        publishedAt: manifest.publishedAt,
        releaseNotes: manifest.releaseNotes,
        artifactSize: artifact.size
      };
      await this.writeState({
        schemaVersion: 1,
        snapshot,
        ...(available ? { candidate: { version: manifest.version, artifact } } : {})
      });
      return snapshot;
    } catch (error) {
      const snapshot: ApplicationUpdateSnapshot = {
        ...previous.snapshot,
        enabled: true,
        status: "failed",
        progress: null,
        message: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString()
      };
      await this.writeState({ schemaVersion: 1, snapshot });
      return snapshot;
    }
  }

  private defaultSnapshot(): ApplicationUpdateSnapshot {
    return {
      enabled: this.enabled,
      currentVersion: this.currentVersion,
      latestVersion: null,
      platform: APPLICATION_UPDATE_PLATFORM,
      updateAvailable: false,
      status: this.enabled ? "idle" : "disabled",
      progress: null,
      message: this.enabled ? "尚未检查更新。" : "自动更新尚未配置。",
      checkedAt: null,
      publishedAt: null,
      releaseNotes: [],
      artifactSize: null
    };
  }

  private async readState(): Promise<StoredUpdateState> {
    try {
      const value = JSON.parse(await readFile(this.stateFile, "utf8")) as unknown;
      if (!isStoredState(value) || value.snapshot.currentVersion !== this.currentVersion) {
        return { schemaVersion: 1, snapshot: this.defaultSnapshot() };
      }
      return value;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || error instanceof SyntaxError) {
        return { schemaVersion: 1, snapshot: this.defaultSnapshot() };
      }
      throw error;
    }
  }

  private writeState(state: StoredUpdateState): Promise<void> {
    return writeJsonAtomic(this.stateFile, state);
  }
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function parseManifest(value: unknown): ApplicationUpdateManifest {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("Update manifest schema is invalid.");
  }
  const version = requireVersion(value.version, "Update version");
  if (typeof value.publishedAt !== "string" || !Number.isFinite(Date.parse(value.publishedAt))) {
    throw new Error("Update publishedAt is invalid.");
  }
  if (!Array.isArray(value.releaseNotes) || value.releaseNotes.some((item) => typeof item !== "string")) {
    throw new Error("Update releaseNotes are invalid.");
  }
  if (!isRecord(value.artifacts)) throw new Error("Update artifacts are invalid.");
  const artifact = parseArtifact(value.artifacts[APPLICATION_UPDATE_PLATFORM]);
  return {
    schemaVersion: 1,
    version,
    publishedAt: value.publishedAt,
    releaseNotes: value.releaseNotes,
    artifacts: { [APPLICATION_UPDATE_PLATFORM]: artifact }
  };
}

function parseArtifact(value: unknown): ApplicationUpdateArtifact {
  if (!isRecord(value) || typeof value.url !== "string") {
    throw new Error("Windows update artifact is invalid.");
  }
  const artifactUrl = new URL(value.url);
  if (artifactUrl.protocol !== "https:" && artifactUrl.protocol !== "http:") {
    throw new Error("Update artifact URL must use HTTP or HTTPS.");
  }
  const url = artifactUrl.toString();
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/iu.test(value.sha256)) {
    throw new Error("Update artifact SHA-256 is invalid.");
  }
  if (!Number.isSafeInteger(value.size) || Number(value.size) < 1) {
    throw new Error("Update artifact size is invalid.");
  }
  return { url, sha256: value.sha256.toLowerCase(), size: Number(value.size) };
}

function requireVersion(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/u.test(value.trim())) {
    throw new Error(`${label} must use major.minor.patch format.`);
  }
  return value.trim();
}

function parseVersion(value: string): [number, number, number] {
  const version = requireVersion(value, "Version");
  const parts = version.split(".").map(Number);
  return [parts[0]!, parts[1]!, parts[2]!];
}

function isStoredState(value: unknown): value is StoredUpdateState {
  return isRecord(value) && value.schemaVersion === 1 && isRecord(value.snapshot) &&
    typeof value.snapshot.currentVersion === "string" &&
    typeof value.snapshot.status === "string";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchManifest(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Update manifest request failed: HTTP ${response.status}.`);
  return response.json() as Promise<unknown>;
}

function launchDetachedHelper(command: readonly string[], requestFile: string): void {
  const [executable, ...arguments_] = command;
  if (!executable) throw new Error("Update helper command is missing.");
  const child = spawn(executable, [...arguments_, requestFile], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}
