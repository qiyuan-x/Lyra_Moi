import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const targets = [
  "apps/web/dist",
  "apps/api/dist",
  "apps/worker/dist",
  "packages/contracts/dist",
  "packages/core/dist",
  "packages/agent-engine/dist",
  "packages/agent-tools/dist",
  "packages/providers/dist",
  "packages/storage/dist",
  "packages/contracts/tsconfig.tsbuildinfo",
  "packages/core/tsconfig.tsbuildinfo",
  "packages/agent-engine/tsconfig.tsbuildinfo",
  "packages/agent-tools/tsconfig.tsbuildinfo",
  "packages/providers/tsconfig.tsbuildinfo",
  "packages/storage/tsconfig.tsbuildinfo",
  "coverage",
  "build",
  "release"
];

for (const relativePath of targets) {
  const target = resolve(root, relativePath);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`Refusing to clean outside workspace: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}

console.log("Cleaned build outputs.");
