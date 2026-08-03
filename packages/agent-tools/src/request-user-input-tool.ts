import type { AgentTool } from "@lyra/agent-engine";

interface RequestUserInputArguments {
  prompt: string;
  choices?: Array<{ id: string; label: string }>;
}

export function createRequestUserInputTool(): AgentTool {
  return {
    definition: {
      name: "request_user_input",
      description: "当继续执行确实需要用户补充信息时，暂停 Agent 并向用户提问。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["prompt"],
        properties: {
          prompt: { type: "string", minLength: 1 },
          choices: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label"],
              properties: {
                id: { type: "string", minLength: 1 },
                label: { type: "string", minLength: 1 }
              }
            }
          }
        }
      }
    },
    async execute(argumentsValue) {
      const input = argumentsValue as RequestUserInputArguments;
      return {
        status: "awaiting_user",
        request: {
          prompt: input.prompt.trim(),
          choices: structuredClone(input.choices ?? [])
        }
      };
    }
  };
}
