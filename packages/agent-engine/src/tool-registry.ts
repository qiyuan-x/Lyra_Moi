import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { AgentToolNotFoundError, AgentToolValidationError } from "./errors.js";
import type {
  AgentTool,
  AgentToolContext,
  AgentToolDefinition,
  AgentToolResult
} from "./types.js";

interface RegisteredTool {
  tool: AgentTool;
  validate: ValidateFunction;
}

export class ToolRegistry {
  readonly #ajv = new Ajv({ allErrors: true, strict: false });
  readonly #tools = new Map<string, RegisteredTool>();

  register(tool: AgentTool): this {
    if (this.#tools.has(tool.definition.name)) {
      throw new Error(`Agent tool already registered: ${tool.definition.name}`);
    }
    this.#tools.set(tool.definition.name, {
      tool,
      validate: this.#ajv.compile(tool.definition.parameters)
    });
    return this;
  }

  definitions(): AgentToolDefinition[] {
    return [...this.#tools.values()].map(({ tool }) => structuredClone(tool.definition));
  }

  async execute(
    toolName: string,
    argumentsValue: unknown,
    context: AgentToolContext,
    signal?: AbortSignal
  ): Promise<AgentToolResult> {
    const registered = this.#tools.get(toolName);
    if (!registered) throw new AgentToolNotFoundError(toolName);
    if (!registered.validate(argumentsValue)) {
      throw new AgentToolValidationError(toolName, formatErrors(registered.validate.errors));
    }
    signal?.throwIfAborted();
    return registered.tool.execute(
      structuredClone(argumentsValue),
      structuredClone(context),
      signal
    );
  }
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return "unknown validation error";
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}
