import { describe, expect, it } from "vitest";
import {
  createPromptArchive,
  createPromptExportPayload,
  parsePromptImportFile,
  parsePromptImport
} from "../../apps/web/src/features/prompts/prompt-transfer.js";

describe("prompt transfer", () => {
  it("parses an exported prompt collection and legacy shortcut notes", () => {
    expect(parsePromptImport(JSON.stringify({
      version: 1,
      prompts: [
        {
          name: " 角色三视图 ",
          content: " 正视图、侧视图、背视图 ",
          category: " 角色 ",
          shortcut: "Nano Banana",
          variables: ["pose", 1],
          favorite: true
        }
      ]
    }))).toEqual([{
      name: "角色三视图",
      content: "正视图、侧视图、背视图",
      category: "角色",
      note: "Nano Banana",
      variables: ["pose"],
      favorite: true
    }]);
  });

  it("exports only selected prompts without storage metadata", () => {
    const payload = createPromptExportPayload([
      {
        id: "prompt-1",
        name: "模板一",
        category: "角色",
        note: null,
        content: "内容",
        variables: [],
        favorite: false,
        previewMimeType: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "prompt-2",
        name: "模板二",
        category: "场景",
        note: "Gemini",
        content: "内容二",
        variables: ["style"],
        favorite: true,
        previewMimeType: "image/png",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ], new Set(["prompt-2"]));

    expect(payload).toEqual({
      version: 1,
      prompts: [{
        name: "模板二",
        category: "场景",
        note: "Gemini",
        content: "内容二",
        variables: ["style"],
        favorite: true
      }]
    });
  });

  it("round-trips prompt previews in a template archive", async () => {
    const prompt = {
      id: "prompt-preview",
      name: "带效果图提示词",
      category: "角色",
      note: null,
      content: "生成角色",
      variables: [],
      favorite: false,
      previewMimeType: "image/webp",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null
    };
    const preview = new Blob([new Uint8Array([4, 5, 6])], { type: "image/webp" });
    const archive = await createPromptArchive(
      [prompt],
      new Set([prompt.id]),
      new Map([[prompt.id, preview]])
    );
    const imported = await parsePromptImportFile(new File(
      [archive],
      "prompts.lyra-template.zip",
      { type: "application/zip" }
    ));
    expect(imported[0]?.value.name).toBe("带效果图提示词");
    expect(imported[0]?.preview?.type).toBe("image/webp");
    await expect(imported[0]?.preview?.arrayBuffer()).resolves.toEqual(
      new Uint8Array([4, 5, 6]).buffer
    );
  });
});
