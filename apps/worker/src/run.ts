import { clearProcessStopFile, watchProcessStopFile } from "@lyra/storage";
import { createWorkerRuntime } from "./runtime.js";
import { fileURLToPath } from "node:url";

const stopFile = process.env.LYRA_STOP_FILE;


try {
  await clearProcessStopFile(stopFile);
  const runtime = await createWorkerRuntime({
    dataDirectory: process.env.LYRA_DATA_DIR?.trim() || fileURLToPath(new URL("../../../data", import.meta.url)),
    ...(process.env.LYRA_AGENT_SYSTEM_PROMPT
      ? { systemPrompt: process.env.LYRA_AGENT_SYSTEM_PROMPT }
      : {}),
    ...(process.env.LYRA_AGENT_SYSTEM_PROMPT_FILE
      ? { systemPromptFile: process.env.LYRA_AGENT_SYSTEM_PROMPT_FILE }
      : { systemPromptFile: fileURLToPath(new URL("../../../resources/prompts/agent-system-v1.txt", import.meta.url)) }),
    ...(process.env.LYRA_WORKER_VERSION ? { version: process.env.LYRA_WORKER_VERSION } : {}),
    pid: process.pid
  });
  let shuttingDown = false;
  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${timestamp()} Workers stopping: ${reason}`);
    watcher.close();
    await runtime.close();
    console.log(`${timestamp()} Workers stopped.`);
  };
  const watcher = watchProcessStopFile(stopFile, () => shutdown("launcher request"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  runtime.start();
  console.log(`${timestamp()} Agent, image, and model workers ready.`);
} catch (error) {
  console.error(`${timestamp()} Worker startup failed.`, error);
  process.exitCode = 1;
}

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}
