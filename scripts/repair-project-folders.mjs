import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";
import { createRuntimeLayout, migrateRuntimeDatabase, openReadyRuntimeDatabase, synchronizeProjectFolders } from "../packages/storage/dist/index.js";

// Run after building, with application services stopped. Never replace the destination database.
const root = fileURLToPath(new URL("../", import.meta.url));
const layout = createRuntimeLayout(process.argv[2] ? resolve(process.argv[2]) : resolve(root, "data"));
const backupDirectory = resolve(layout.root, "backups", `project-repair-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`);
await mkdir(backupDirectory, { recursive: true });
if (existsSync(layout.databaseFile)) {
  const source = new DatabaseSync(layout.databaseFile, { readOnly: true });
  try { await backup(source, resolve(backupDirectory, "lyra.sqlite3")); }
  finally { source.close(); }
}
console.log(`Database backup: ${backupDirectory}`);
await migrateRuntimeDatabase(layout);
const database = await openReadyRuntimeDatabase(layout);
try {
  const report = await synchronizeProjectFolders(database, layout);
  await writeFile(resolve(backupDirectory, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
} finally { database.close(); }
