import type { DatabaseMigration } from "../migration-runner.js";
import { initialSchemaMigration } from "./001-initial-schema.js";
import { providerModelSoftDeleteMigration } from "./002-provider-model-soft-delete.js";
import { jobRetryLinkMigration } from "./003-job-retry-link.js";
import { builtInPromptsMigration } from "./004-built-in-prompts.js";
import { providerDefaultsMigration } from "./005-provider-defaults.js";
import { providerProfileScopeMigration } from "./006-provider-profile-scope.js";
import { exclusiveProviderProfileMigration } from "./007-exclusive-provider-profile.js";
import { agentImagePromptModeMigration } from "./008-agent-image-prompt-mode.js";
import { jobDismissalMigration } from "./009-job-dismissal.js";
import { modelGenerationMigration } from "./010-model-generation.js";
import { globalPromptsMigration } from "./011-global-prompts.js";
import { multipleEnabledProvidersMigration } from "./012-multiple-enabled-providers.js";
import { jobProviderSnapshotsMigration } from "./013-job-provider-snapshots.js";
import { agentModelSelectionMigration } from "./014-agent-model-selection.js";
import { restoreHiddenConversationsMigration } from "./015-restore-hidden-conversations.js";
import { openAiCompatibleModelAdapterMigration } from "./016-openai-compatible-model-adapter.js";
import { removeCompatibleModelIdMigration } from "./017-remove-compatible-model-id.js";
import { promptTemplatePreviewsMigration } from "./018-prompt-template-previews.js";

export const lyraMigrations: readonly DatabaseMigration[] = [
  initialSchemaMigration,
  providerModelSoftDeleteMigration,
  jobRetryLinkMigration,
  builtInPromptsMigration,
  providerDefaultsMigration,
  providerProfileScopeMigration,
  exclusiveProviderProfileMigration,
  agentImagePromptModeMigration,
  jobDismissalMigration,
  modelGenerationMigration,
  globalPromptsMigration,
  multipleEnabledProvidersMigration,
  jobProviderSnapshotsMigration,
  agentModelSelectionMigration,
  restoreHiddenConversationsMigration,
  openAiCompatibleModelAdapterMigration,
  removeCompatibleModelIdMigration,
  promptTemplatePreviewsMigration
];
