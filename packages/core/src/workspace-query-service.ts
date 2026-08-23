import type {
  AgentRunSnapshot,
  AgentStepSnapshot,
  ConversationSnapshot,
  JobListQuery,
  JobSnapshot,
  MessageSnapshot,
  ProjectSnapshot
} from "@lyra/contracts";
import type { ImageMode } from "@lyra/contracts";
import type {
  AgentRunRepository,
  AgentStepRepository,
  ConversationRepository,
  JobRepository,
  RetryProviderSelection,
  ProjectDirectoryStore,
  ProjectRepository
} from "@lyra/storage";

export interface WorkspaceQueryServiceOptions {
  projects: ProjectRepository;
  conversations: ConversationRepository;
  agentRuns: AgentRunRepository;
  agentSteps: AgentStepRepository;
  jobs: JobRepository;
  projectDirectories?: ProjectDirectoryStore;
}

export class WorkspaceQueryService {
  readonly #projects: ProjectRepository;
  readonly #conversations: ConversationRepository;
  readonly #agentRuns: AgentRunRepository;
  readonly #agentSteps: AgentStepRepository;
  readonly #jobs: JobRepository;
  readonly #projectDirectories: ProjectDirectoryStore | null;

  constructor(options: WorkspaceQueryServiceOptions) {
    this.#projects = options.projects;
    this.#conversations = options.conversations;
    this.#agentRuns = options.agentRuns;
    this.#agentSteps = options.agentSteps;
    this.#jobs = options.jobs;
    this.#projectDirectories = options.projectDirectories ?? null;
  }

  listProjects(): ProjectSnapshot[] {
    return this.#projects.listActive();
  }

  createProject(value: unknown): ProjectSnapshot {
    if (!isRecord(value)) throw new Error("Project input is required.");
    const name = requireProjectName(value.name);
    const description = normalizeProjectDescription(value.description);
    const project = this.#projects.create({ name, description });
    this.#projectDirectories?.ensure(project.id);
    return project;
  }

  updateProject(projectId: string, value: unknown): ProjectSnapshot {
    if (!isRecord(value)) throw new Error("Project input is required.");
    const input: {
      name?: string;
      description?: string;
      lastImageMode?: ImageMode;
    } = {};
    if (value.name !== undefined) input.name = requireProjectName(value.name);
    if (value.description !== undefined) input.description = normalizeProjectDescription(value.description);
    if (value.lastImageMode !== undefined) {
      if (value.lastImageMode !== "agent" && value.lastImageMode !== "manual") {
        throw new Error("lastImageMode must be agent or manual.");
      }
      input.lastImageMode = value.lastImageMode;
    }
    if (Object.keys(input).length === 0) throw new Error("Project update is empty.");
    return this.#projects.update(projectId, input);
  }

  deleteProject(projectId: string): ProjectSnapshot {
    const active = this.#projects.listActive();
    if (active.length <= 1) throw new Error("At least one active project is required.");
    const deleted = this.#projects.deletePermanently(projectId);
    this.#projectDirectories?.delete(projectId);
    return deleted;
  }

  updateProjectImageMode(projectId: string, value: unknown): ProjectSnapshot {
    return this.updateProject(projectId, value);
  }

  listConversations(projectId: string): ConversationSnapshot[] {
    return this.#conversations.list(projectId);
  }

  listMessages(conversationId: string): MessageSnapshot[] {
    this.#conversations.requireById(conversationId);
    return this.#conversations.listMessages(conversationId);
  }

  getAgentRun(agentRunId: string): AgentRunSnapshot {
    return toAgentRunSnapshot(this.#agentRuns.requireStored(agentRunId));
  }

  listAgentRuns(conversationId: string): AgentRunSnapshot[] {
    this.#conversations.requireById(conversationId);
    return this.#agentRuns.listByConversation(conversationId);
  }

  listPublicAgentSteps(agentRunId: string): AgentStepSnapshot[] {
    this.#agentRuns.requireStored(agentRunId);
    return this.#agentSteps.list(agentRunId).map(sanitizeAgentStep);
  }

  cancelAgentRun(agentRunId: string, cancelChildJobs = true): AgentRunSnapshot {
    const run = this.#agentRuns.requestCancel(agentRunId);
    if (cancelChildJobs) {
      for (const job of this.#jobs.list({ projectId: run.projectId, agentRunId, limit: 200 })) {
        if (!isTerminalJob(job.status)) this.#jobs.requestCancel(job.id);
      }
    }
    return run;
  }

  listJobs(query: JobListQuery): JobSnapshot[] {
    return this.#jobs.list(query);
  }

  getJob(jobId: string): JobSnapshot {
    const job = this.#jobs.findById(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    return job;
  }

  cancelJob(jobId: string): JobSnapshot {
    return this.#jobs.requestCancel(jobId);
  }

  retryJob(jobId: string, providerSelection?: RetryProviderSelection): JobSnapshot {
    return this.#jobs.retry(jobId, providerSelection);
  }

  dismissJob(jobId: string): JobSnapshot {
    return this.#jobs.dismiss(jobId);
  }

  clearFailedJobs(projectId: string): number {
    return this.#jobs.dismissFailed(projectId);
  }
}

function sanitizeAgentStep(step: AgentStepSnapshot): AgentStepSnapshot {
  let payload: Record<string, unknown> = {};
  if (step.type === "tool_call") {
    payload = selectKeys(step.payload, ["toolCallId", "toolName", "toolCallCount", "arguments"]);
  } else if (step.type === "tool_result") {
    payload = selectKeys(step.payload, ["toolCallId", "taskId", "content", "error"]);
  } else if (step.type === "user_input_request") {
    payload = selectKeys(step.payload, ["toolCallId", "request"]);
  } else if (step.type === "user_input_result") {
    payload = selectKeys(step.payload, ["requestStepId", "messageId"]);
  } else if (step.type === "final_message") {
    payload = selectKeys(step.payload, ["messageId", "text"]);
  }
  return { ...step, payload };
}

function selectKeys(
  payload: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => payload[key] !== undefined).map((key) => [key, structuredClone(payload[key])])
  );
}

function toAgentRunSnapshot(run: ReturnType<AgentRunRepository["requireStored"]>): AgentRunSnapshot {
  return {
    id: run.id,
    projectId: run.projectId,
    conversationId: run.conversationId,
    requestMessageId: run.requestMessageId,
    status: run.status,
    toolCallCount: run.toolCallCount,
    currentStep: run.currentStep,
    cancelRequested: run.cancelRequested,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt
  };
}

function isTerminalJob(status: string): boolean {
  return ["succeeded", "failed", "cancelled", "interrupted"].includes(status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireProjectName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Project name is required.");
  const name = value.trim();
  if (!name || name.length > 100) throw new Error("Project name must contain 1 to 100 characters.");
  return name;
}

function normalizeProjectDescription(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error("Project description must be text.");
  const description = value.trim();
  if (description.length > 500) throw new Error("Project description cannot exceed 500 characters.");
  return description;
}
