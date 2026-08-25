import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LyraDatabase,
  MigrationRequiredError,
  ProjectRepository,
  ProviderRepository,
  applyMigrations,
  assertMigrationsCurrent,
  lyraMigrations
} from "@lyra/storage";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("SQLite migrations", () => {
  it("creates the full schema from zero and is idempotent", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-db-"));
    temporaryDirectories.push(parent);
    const database = new LyraDatabase(join(parent, "database", "lyra.sqlite3"));

    try {
      expect(applyMigrations(database.connection, lyraMigrations)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
      expect(applyMigrations(database.connection, lyraMigrations)).toEqual([]);
      expect(() => assertMigrationsCurrent(database.connection, lyraMigrations)).not.toThrow();

      const tables = database.connection
        .prepare(`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `)
        .all() as unknown as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual([
        "agent_runs",
        "agent_steps",
        "app_settings",
        "asset_tags",
        "assets",
        "conversations",
        "job_inputs",
        "job_outputs",
        "jobs",
        "message_attachments",
        "messages",
        "projects",
        "prompt_templates",
        "provider_models",
        "provider_profiles",
        "runtime_events",
        "schema_migrations",
        "worker_instances"
      ]);
      expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(
        database.connection.prepare(`
          SELECT name
          FROM pragma_table_info('prompt_templates')
          WHERE name = 'preview_mime_type'
        `).all()
      ).toEqual([{ name: "preview_mime_type" }]);
      expect(
        database.connection.prepare(`
          SELECT "notnull", dflt_value
          FROM pragma_table_info('agent_runs')
          WHERE name = 'optimize_image_prompt'
        `).get()
      ).toMatchObject({ notnull: 1, dflt_value: "1" });
      expect(
        database.connection.prepare(`
          SELECT name
          FROM pragma_table_info('agent_runs')
          WHERE name IN ('default_model_profile_id', 'default_model_model_id')
          ORDER BY cid
        `).all()
      ).toEqual([
        { name: "default_model_profile_id" },
        { name: "default_model_model_id" }
      ]);
      expect(
        database.connection.prepare(`
          SELECT name
          FROM pragma_table_info('jobs')
          WHERE name = 'dismissed_at'
        `).get()
      ).toMatchObject({ name: "dismissed_at" });
      expect(
        database.connection.prepare(`
          SELECT name
          FROM pragma_table_info('jobs')
          WHERE name = 'external_task_id'
        `).get()
      ).toMatchObject({ name: "external_task_id" });
      expect(
        database.connection.prepare(`
          SELECT name
          FROM pragma_table_info('jobs')
          WHERE name IN ('provider_name_snapshot', 'remote_model_id_snapshot')
          ORDER BY cid
        `).all()
      ).toEqual([
        { name: "provider_name_snapshot" },
        { name: "remote_model_id_snapshot" }
      ]);
      expect(
        database.connection.prepare(`
          SELECT name
          FROM pragma_table_info('provider_profiles')
          WHERE name = 'adapter_type'
        `).get()
      ).toMatchObject({ name: "adapter_type" });
      expect(
        database.connection.prepare("SELECT COUNT(*) AS count FROM prompt_templates").get()
      ).toMatchObject({ count: 3 });
      expect(
        database.connection.prepare(`
          SELECT service_type, COUNT(*) AS count
          FROM provider_profiles
          WHERE json_extract(settings_json, '$.__lyra.starter') = 1
          GROUP BY service_type
          ORDER BY service_type
        `).all()
      ).toEqual([
        { service_type: "image", count: 3 },
        { service_type: "llm", count: 3 },
        { service_type: "model", count: 1 }
      ]);
      expect(
        database.connection.prepare(`
          SELECT name
          FROM pragma_table_info('prompt_templates')
          ORDER BY cid
        `).all()
      ).toEqual(expect.arrayContaining([
        { name: "category" },
        { name: "note" },
        { name: "favorite" }
      ]));
      expect(
        database.connection.prepare(`
          SELECT name
          FROM pragma_table_info('prompt_templates')
          WHERE name IN ('project_id', 'shortcut')
        `).all()
      ).toEqual([]);
      expect(
        database.connection.prepare("PRAGMA foreign_keys").get()
      ).toMatchObject({ foreign_keys: 1 });
      expect(database.connection.prepare("PRAGMA journal_mode").get()).toMatchObject({
        journal_mode: "wal"
      });
      expect(database.connection.prepare("PRAGMA busy_timeout").get()).toMatchObject({
        timeout: 5000
      });
    } finally {
      database.close();
    }
  });

  it("rejects missing and changed migration versions", () => {
    const database = new LyraDatabase(":memory:");
    try {
      expect(() =>
        assertMigrationsCurrent(database.connection, lyraMigrations)
      ).toThrow(MigrationRequiredError);
      applyMigrations(database.connection, lyraMigrations);
      database.connection
        .prepare("UPDATE schema_migrations SET name = ? WHERE version = 1")
        .run("changed_name");
      expect(() =>
        assertMigrationsCurrent(database.connection, lyraMigrations)
      ).toThrow("Unknown or changed database migration");
    } finally {
      database.close();
    }
  });

  it("repairs legacy DeepSeek profiles and backfills application defaults", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-db-upgrade-"));
    temporaryDirectories.push(parent);
    const database = new LyraDatabase(join(parent, "database", "lyra.sqlite3"));

    try {
      applyMigrations(database.connection, lyraMigrations.slice(0, 4));
      const now = new Date().toISOString();
      database.connection.prepare(`
        INSERT INTO provider_profiles (
          id, name, protocol, base_url, api_key_env, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        "deepseek-profile",
        "deepseek",
        "openai",
        "https://api.deepseek.com",
        "LYRA_PROVIDER_DEEPSEEK_API_KEY",
        now,
        now
      );
      database.connection.prepare(`
        INSERT INTO provider_models (
          id, provider_profile_id, service_type, remote_model_id, display_name,
          enabled, is_default, settings_json, created_at, updated_at
        ) VALUES (?, ?, 'llm', ?, ?, 1, 0, '{}', ?, ?)
      `).run("deepseek-model", "deepseek-profile", "deepseek-chat", "DeepSeek Chat", now, now);

      expect(applyMigrations(database.connection, lyraMigrations)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
      expect(
        database.connection.prepare("SELECT protocol, service_type, base_url FROM provider_profiles WHERE id = ?").get("deepseek-profile")
      ).toMatchObject({
        protocol: "openai-compatible",
        service_type: "llm",
        base_url: "https://api.deepseek.com/v1"
      });
      expect(
        database.connection.prepare("SELECT value_json FROM app_settings WHERE key = ?").get("default_llm_model_id")
      ).toMatchObject({ value_json: '"deepseek-model"' });
    } finally {
      database.close();
    }
  });

  it("moves project prompts into the global library and preserves shortcut text as a note", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-db-prompts-"));
    temporaryDirectories.push(parent);
    const database = new LyraDatabase(join(parent, "database", "lyra.sqlite3"));

    try {
      applyMigrations(database.connection, lyraMigrations.slice(0, 10));
      const now = new Date().toISOString();
      database.connection.prepare(`
        INSERT INTO projects (
          id, name, description, last_image_mode, created_at, updated_at
        ) VALUES (?, ?, '', 'agent', ?, ?)
      `).run("prompt-project", "Prompt project", now, now);
      database.connection.prepare(`
        INSERT INTO prompt_templates (
          id, project_id, name, category, shortcut, content, variables_json,
          favorite, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, '[]', 1, ?, ?, NULL)
      `).run(
        "project-prompt",
        "prompt-project",
        "Character polish",
        "Character",
        "Nano Banana works better",
        "Keep the character identity.",
        now,
        now
      );

      expect(applyMigrations(database.connection, lyraMigrations)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19]);
      expect(
        database.connection.prepare(`
          SELECT id, name, category, note, favorite
          FROM prompt_templates
          WHERE id = ?
        `).get("project-prompt")
      ).toMatchObject({
        id: "project-prompt",
        name: "Character polish",
        category: "Character",
        note: "Nano Banana works better",
        favorite: 1
      });
      expect(
        database.connection.prepare(`
          SELECT name
          FROM pragma_table_info('prompt_templates')
          WHERE name = 'project_id'
        `).get()
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("backfills provider and remote model snapshots for existing jobs", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-db-job-snapshot-"));
    temporaryDirectories.push(parent);
    const database = new LyraDatabase(join(parent, "database", "lyra.sqlite3"));

    try {
      applyMigrations(database.connection, lyraMigrations.slice(0, 12));
      const project = new ProjectRepository(database).ensureDefaultProject("Snapshot test");
      const providers = new ProviderRepository(database);
      const profile = providers.createProfile({
        id: "snapshot-provider",
        serviceType: "image",
        name: "Gemini image",
        protocol: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKeyEnvironmentVariable: "LYRA_SNAPSHOT_TEST_KEY"
      });
      const model = providers.createModel(profile.id, {
        id: "snapshot-model",
        serviceType: "image",
        remoteModelId: "gemini-3.1-flash-image",
        displayName: "Nano Banana 2"
      });
      const now = new Date().toISOString();
      database.connection.prepare(`
        INSERT INTO jobs (
          id, project_id, source, kind, status, title, stage,
          provider_profile_id, provider_model_id, prompt, request_json,
          attempt, created_at, updated_at
        ) VALUES (
          'snapshot-job', ?, 'manual', 'image.generate', 'queued',
          'Snapshot job', 'queued', ?, ?, 'test', '{}', 1, ?, ?
        )
      `).run(project.id, profile.id, model.id, now, now);

      expect(applyMigrations(database.connection, lyraMigrations)).toEqual([13, 14, 15, 16, 17, 18, 19]);
      expect(database.connection.prepare(`
        SELECT provider_name_snapshot, remote_model_id_snapshot
        FROM jobs
        WHERE id = 'snapshot-job'
      `).get()).toEqual({
        provider_name_snapshot: "Gemini image",
        remote_model_id_snapshot: "gemini-3.1-flash-image"
      });
    } finally {
      database.close();
    }
  });

  it("moves FrostAPI 3D profiles to the generic OpenAI-compatible adapter", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-db-model-adapter-"));
    temporaryDirectories.push(parent);
    const database = new LyraDatabase(join(parent, "database", "lyra.sqlite3"));

    try {
      applyMigrations(database.connection, lyraMigrations.slice(0, 15));
      const now = new Date().toISOString();
      database.connection.prepare(`
        INSERT INTO provider_profiles (
          id, service_type, name, protocol, adapter_type, base_url, api_key_env,
          secondary_api_key_env, settings_json, enabled, created_at, updated_at, deleted_at
        ) VALUES (?, 'model', ?, 'openai-compatible', 'frost-model', ?, ?, NULL, ?, 1, ?, ?, NULL)
      `).run(
        "frost-model-profile",
        "FrostAPI 3D",
        "https://api.linfrsot.cloud",
        "LYRA_PROVIDER_FROST_MODEL_API_KEY",
        JSON.stringify({ __lyra: { providerKind: "frostapi" } }),
        now,
        now
      );

      expect(applyMigrations(
        database.connection,
        lyraMigrations.slice(0, 16)
      )).toEqual([16]);
      database.connection.prepare(`
        UPDATE provider_profiles
        SET settings_json = json_set(settings_json, '$.modelId', 'meshy-t2')
        WHERE id = 'frost-model-profile'
      `).run();
      expect(applyMigrations(database.connection, lyraMigrations)).toEqual([17, 18, 19]);
      const migrated = database.connection.prepare(`
        SELECT adapter_type, settings_json
        FROM provider_profiles
        WHERE id = 'frost-model-profile'
      `).get() as { adapter_type: string; settings_json: string };
      expect(migrated.adapter_type).toBe("openai-compatible");
      expect(JSON.parse(migrated.settings_json)).toEqual({
        __lyra: { providerKind: "frostapi" }
      });
    } finally {
      database.close();
    }
  });

  it("rolls back failed transactions", () => {
    const database = new LyraDatabase(":memory:");
    try {
      applyMigrations(database.connection, lyraMigrations);
      expect(() =>
        database.transaction(() => {
          const now = new Date().toISOString();
          database.connection
            .prepare(`
              INSERT INTO projects (
                id, name, description, last_image_mode, created_at, updated_at
              ) VALUES (?, ?, '', 'agent', ?, ?)
            `)
            .run("rolled-back", "test", now, now);
          throw new Error("stop");
        })
      ).toThrow("stop");
      expect(
        database.connection.prepare("SELECT COUNT(*) AS count FROM projects").get()
      ).toMatchObject({ count: 0 });
    } finally {
      database.close();
    }
  });
});
