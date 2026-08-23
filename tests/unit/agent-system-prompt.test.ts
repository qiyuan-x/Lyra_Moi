import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("agent system prompt", () => {
  it("describes capabilities without assigning a fixed persona", async () => {
    const prompt = await readFile(
      resolve("resources", "prompts", "agent-system-v1.txt"),
      "utf8"
    );

    expect(prompt).not.toContain("你是 Lyra 的图片生成助手");
    expect(prompt).toContain("生成图片");
    expect(prompt).toContain("修改图片");
    expect(prompt).toContain("3D 模型");
    expect(prompt).toContain("不要声明固定人设");
    expect(prompt).toContain("提示词原样使用");
    expect(prompt).toContain("必须保持该段文字不变");
  });
});
