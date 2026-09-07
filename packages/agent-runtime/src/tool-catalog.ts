import { Ajv, type ValidateFunction } from "ajv";
import type { RunContext, RuntimeTool, ToolDefinition } from "./protocol.js";

export class ToolCatalog {
  private readonly tools = new Map<string, { tool: RuntimeTool; validate: ValidateFunction }>();
  private readonly validator = new Ajv({ allErrors: true, strict: false });

  register(tool: RuntimeTool): this {
    const name = tool.definition.name;
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(name) || this.tools.has(name)) {
      throw new Error(`Invalid or duplicate tool: ${name}`);
    }
    this.tools.set(name, { tool, validate: this.validator.compile(tool.definition.parameters) });
    return this;
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map(({ tool }) => structuredClone(tool.definition));
  }

  require(name: string): RuntimeTool {
    const item = this.tools.get(name);
    if (!item) throw new Error(`Unknown tool: ${name}`);
    return item.tool;
  }

  prepare(name: string, value: unknown, context: RunContext): unknown {
    const item = this.tools.get(name);
    if (!item) throw new Error(`Unknown tool: ${name}`);
    if (!item.validate(value)) throw new Error(`Invalid ${name} arguments: ${this.validator.errorsText(item.validate.errors)}`);
    return structuredClone(item.tool.prepare ? item.tool.prepare(value, context) : value);
  }
}
