import type { DatabaseMigration } from "../migration-runner.js";

export const restoreHiddenConversationsMigration: DatabaseMigration = {
  version: 15,
  name: "restore_hidden_conversations",
  sql: `
    UPDATE conversations
    SET deleted_at = NULL
    WHERE deleted_at IS NOT NULL;
  `
};
