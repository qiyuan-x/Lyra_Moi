import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface RuntimeLayout {
  root: string;
  config: string;
  database: string;
  projects: string;
  blobs: string;
  thumbnails: string;
  logs: string;
  temp: string;
  run: string;
  promptPreviews: string;
  environmentFile: string;
  databaseFile: string;
}

export interface ResolveDataDirectoryOptions {
  explicitDataDirectory?: string;
  environment?: NodeJS.ProcessEnv;
  workingDirectory?: string;
  launcherExecutablePath?: string;
}

export function resolveDataDirectory(options: ResolveDataDirectoryOptions = {}): string {
  const workingDirectory = options.workingDirectory ?? process.cwd();
  if (options.explicitDataDirectory?.trim()) {
    return resolve(workingDirectory, options.explicitDataDirectory.trim());
  }

  const environment = options.environment ?? process.env;
  const environmentDirectory = environment.LYRA_DATA_DIR?.trim();
  if (environmentDirectory) return resolve(workingDirectory, environmentDirectory);

  if (options.launcherExecutablePath?.trim()) {
    return resolve(dirname(resolve(workingDirectory, options.launcherExecutablePath)), "data");
  }

  return resolve(workingDirectory, "data");
}

export function createRuntimeLayout(dataDirectory: string): RuntimeLayout {
  const root = resolve(dataDirectory);
  const config = resolve(root, "config");
  const database = resolve(root, "database");
  return {
    root,
    config,
    database,
    projects: resolve(root, "projects"),
    blobs: resolve(root, "blobs"),
    thumbnails: resolve(root, "thumbnails"),
    logs: resolve(root, "logs"),
    temp: resolve(root, "temp"),
    run: resolve(root, "run"),
    promptPreviews: resolve(root, "prompt-previews"),
    environmentFile: resolve(config, ".env"),
    databaseFile: resolve(database, "lyra.sqlite3")
  };
}

export async function ensureRuntimeLayout(layout: RuntimeLayout): Promise<void> {
  await Promise.all(
    [
      layout.root,
      layout.config,
      layout.database,
      layout.projects,
      layout.blobs,
      layout.thumbnails,
      layout.logs,
      layout.temp,
      layout.run,
      layout.promptPreviews
    ].map((directory) => mkdir(directory, { recursive: true }))
  );
}
