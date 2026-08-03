import {
  ProjectRepository,
  ProviderRepository,
  applyMigrations,
  lyraMigrations,
  type LyraDatabase
} from "@lyra/storage";

export interface M4Seed {
  projectId: string;
  providerProfileId: string;
  llmProviderProfileId: string;
  imageModelId: string;
  llmModelId: string;
}

export function prepareM4Database(database: LyraDatabase): M4Seed {
  applyMigrations(database.connection, lyraMigrations);
  const project = new ProjectRepository(database).ensureDefaultProject("M4 test");
  const providers = new ProviderRepository(database);
  const imageProfile = providers.createProfile({
    id: "provider-image-test",
    serviceType: "image",
    name: "Test image provider",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1/v1",
    apiKeyEnvironmentVariable: "LYRA_TEST_API_KEY"
  });
  const imageModel = providers.createModel(imageProfile.id, {
    serviceType: "image",
    remoteModelId: "image-test",
    displayName: "Image test",
    enabled: true,
    isDefault: true,
    settings: {}
  });
  const llmProfile = providers.createProfile({
    id: "provider-llm-test",
    serviceType: "llm",
    name: "Test LLM provider",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1/v1",
    apiKeyEnvironmentVariable: "LYRA_TEST_LLM_API_KEY"
  });
  const llmModel = providers.createModel(llmProfile.id, {
    serviceType: "llm",
    remoteModelId: "llm-test",
    displayName: "LLM test",
    enabled: true,
    isDefault: true,
    settings: {}
  });
  return {
    projectId: project.id,
    providerProfileId: imageProfile.id,
    llmProviderProfileId: llmProfile.id,
    imageModelId: imageModel.id,
    llmModelId: llmModel.id
  };
}

export function insertQueuedAgentRun(database: LyraDatabase, seed: M4Seed, id: string): void {
  const now = new Date().toISOString();
  const conversationId = `${id}-conversation`;
  const messageId = `${id}-message`;
  database.connection
    .prepare(`
      INSERT INTO conversations (id, project_id, title, created_at, updated_at)
      VALUES (?, ?, '', ?, ?)
    `)
    .run(conversationId, seed.projectId, now, now);
  database.connection
    .prepare(`
      INSERT INTO messages (id, conversation_id, role, text, created_at)
      VALUES (?, ?, 'user', 'test', ?)
    `)
    .run(messageId, conversationId, now);
  database.connection
    .prepare(`
      INSERT INTO agent_runs (
        id, project_id, conversation_id, request_message_id, status,
        llm_provider_profile_id, llm_provider_model_id,
        default_image_profile_id, default_image_model_id,
        system_prompt_version, max_tool_calls, tool_call_count, current_step,
        cancel_requested, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, 'test-v1', 8, 0, 0, 0, ?, ?)
    `)
    .run(
      id,
      seed.projectId,
      conversationId,
      messageId,
      seed.llmProviderProfileId,
      seed.llmModelId,
      seed.providerProfileId,
      seed.imageModelId,
      now,
      now
    );
}
