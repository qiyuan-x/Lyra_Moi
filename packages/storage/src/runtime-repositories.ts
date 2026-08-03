import type { LyraDatabase } from "./database.js";
import { AgentRunRepository } from "./agent-run-repository.js";
import { AgentStepRepository } from "./agent-step-repository.js";
import { AppSettingsRepository } from "./app-settings-repository.js";
import { AssetRepository } from "./asset-repository.js";
import { ConversationRepository } from "./conversation-repository.js";
import { JobRepository } from "./job-repository.js";
import { ProjectRepository } from "./project-repository.js";
import { PromptTemplateRepository } from "./prompt-template-repository.js";
import { ProviderRepository } from "./provider-repository.js";
import { RuntimeEventRepository } from "./runtime-event-repository.js";
import { WorkerInstanceRepository } from "./worker-instance-repository.js";

/**
 * Shared repository composition for the API and worker runtimes.
 *
 * Keeping this wiring in one place prevents the two processes from slowly
 * drifting into different repository configurations.
 */
export interface RuntimeRepositories {
  readonly runtimeEvents: RuntimeEventRepository;
  readonly projects: ProjectRepository;
  readonly conversations: ConversationRepository;
  readonly agentRuns: AgentRunRepository;
  readonly agentSteps: AgentStepRepository;
  readonly assets: AssetRepository;
  readonly providers: ProviderRepository;
  readonly settings: AppSettingsRepository;
  readonly jobs: JobRepository;
  readonly prompts: PromptTemplateRepository;
  readonly workers: WorkerInstanceRepository;
}

export function createRuntimeRepositories(database: LyraDatabase): RuntimeRepositories {
  const runtimeEvents = new RuntimeEventRepository(database);
  return {
    runtimeEvents,
    projects: new ProjectRepository(database),
    conversations: new ConversationRepository(database),
    agentRuns: new AgentRunRepository(database, runtimeEvents),
    agentSteps: new AgentStepRepository(database),
    assets: new AssetRepository(database),
    providers: new ProviderRepository(database),
    settings: new AppSettingsRepository(database),
    jobs: new JobRepository(database, runtimeEvents),
    prompts: new PromptTemplateRepository(database),
    workers: new WorkerInstanceRepository(database)
  };
}
