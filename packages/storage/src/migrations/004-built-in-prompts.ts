import type { DatabaseMigration } from "../migration-runner.js";

export const builtInPromptsMigration: DatabaseMigration = {
  version: 4,
  name: "built_in_prompts",
  sql: `
    INSERT OR IGNORE INTO prompt_templates (
      id, project_id, name, category, shortcut, content, variables_json,
      favorite, created_at, updated_at, deleted_at
    ) VALUES
      (
        'builtin-three-view', NULL, '生成三视图', '角色设计', '三视图',
        '基于本次引用的图片生成角色三视图，在同一画面中清晰展示正面、侧面和背面，保持角色身份、服装、比例、材质和配色一致，使用中性站姿和简洁背景。',
        '[]', 0, '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL
      ),
      (
        'builtin-detail-part', NULL, '单独展示并细化部件', '细节设计', '部件细化',
        '仅展示并细化我在说明中指定的部件。保持它与本次引用角色的设计语言、材质和配色一致，使用清晰背景，突出结构、连接关系和可见细节。',
        '[]', 0, '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL
      ),
      (
        'builtin-controlled-replace', NULL, '按参考图替换指定内容', '图片编辑', '参考替换',
        '按照我的说明，用指定参考图中的内容替换目标图中的对应内容。除明确要求修改的部分外，保持目标图的构图、姿势、镜头、光照和其他元素不变。',
        '[]', 0, '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', NULL
      );
  `
};
