import { clearProcessStopFile, watchProcessStopFile } from "@lyra/storage";
import { createApiRuntime } from "./runtime.js";

const host = process.env.LYRA_HOST?.trim() || "127.0.0.1";
const port = parsePort(process.env.LYRA_PORT);
const stopFile = process.env.LYRA_STOP_FILE;
const deploymentMode = process.env.LYRA_DEPLOYMENT_MODE?.trim() || "development";
const accessToken = process.env.LYRA_ACCESS_TOKEN?.trim();

try {
  if (deploymentMode === "server" && !accessToken) {
    throw new Error("LYRA_ACCESS_TOKEN is required in server deployment mode.");
  }
  await clearProcessStopFile(stopFile);
  const runtime = await createApiRuntime({
    ...(process.env.LYRA_DATA_DIR ? { dataDirectory: process.env.LYRA_DATA_DIR } : {}),
    ...(process.env.LYRA_WEB_DIST ? { webRoot: process.env.LYRA_WEB_DIST } : {}),
    ...(process.env.LYRA_WORKER_VERSION ? { workerVersion: process.env.LYRA_WORKER_VERSION } : {}),
    ...(process.env.LYRA_AGENT_SYSTEM_PROMPT
      ? { systemPrompt: process.env.LYRA_AGENT_SYSTEM_PROMPT }
      : {}),
    ...(process.env.LYRA_AGENT_SYSTEM_PROMPT_FILE
      ? { systemPromptFile: process.env.LYRA_AGENT_SYSTEM_PROMPT_FILE }
      : {}),
    ...(accessToken ? { accessToken } : {})
  });
  let shuttingDown = false;
  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${timestamp()} API stopping: ${reason}`);
    watcher.close();
    await runtime.close();
    console.log(`${timestamp()} API stopped.`);
  };
  const watcher = watchProcessStopFile(stopFile, () => shutdown("launcher request"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await new Promise<void>((resolveListen, rejectListen) => {
    runtime.server.once("error", rejectListen);
    runtime.server.listen(port, host, () => {
      runtime.server.off("error", rejectListen);
      resolveListen();
    });
  });
  console.log(`${timestamp()} API ready at http://${host}:${port}`);
  console.log(`${timestamp()} Default project: ${runtime.defaultProjectId}`);
} catch (error) {
  console.error(`${timestamp()} API startup failed.`, error);
  process.exitCode = 1;
}

function parsePort(value: string | undefined): number {
  const port = Number(value?.trim() || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("LYRA_PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}
