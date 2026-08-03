import {
  createRuntimeLayout,
  migrateRuntimeDatabase,
  resolveDataDirectory
} from "../packages/storage/dist/index.js";

const explicitDataDirectory = process.argv[2];
const dataDirectory = resolveDataDirectory(
  explicitDataDirectory ? { explicitDataDirectory } : undefined
);
const layout = createRuntimeLayout(dataDirectory);
const appliedVersions = await migrateRuntimeDatabase(layout);

if (appliedVersions.length === 0) {
  console.log("Database is already current.");
} else {
  console.log(`Applied database migrations: ${appliedVersions.join(", ")}`);
}
