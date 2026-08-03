import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

function workspacePath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      "@lyra/contracts": workspacePath("./packages/contracts/src/index.ts"),
      "@lyra/core": workspacePath("./packages/core/src/index.ts"),
      "@lyra/agent-engine": workspacePath("./packages/agent-engine/src/index.ts"),
      "@lyra/agent-tools": workspacePath("./packages/agent-tools/src/index.ts"),
      "@lyra/providers": workspacePath("./packages/providers/src/index.ts"),
      "@lyra/storage": workspacePath("./packages/storage/src/index.ts"),
      "@lyra/api": workspacePath("./apps/api/src/index.ts"),
      "@lyra/worker": workspacePath("./apps/worker/src/index.ts")
    }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
    clearMocks: true
  }
});
