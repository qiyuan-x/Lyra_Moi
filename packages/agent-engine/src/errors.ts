export class AgentToolNotFoundError extends Error {
  constructor(toolName: string) {
    super(`Agent tool not found: ${toolName}`);
    this.name = "AgentToolNotFoundError";
  }
}

export class AgentToolValidationError extends Error {
  constructor(toolName: string, detail: string) {
    super(`Invalid arguments for agent tool ${toolName}: ${detail}`);
    this.name = "AgentToolValidationError";
  }
}

export class AgentToolCallLimitError extends Error {
  constructor(limit: number) {
    super(`Agent tool call limit reached: ${limit}`);
    this.name = "AgentToolCallLimitError";
  }
}

export class AgentCheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentCheckpointError";
  }
}

