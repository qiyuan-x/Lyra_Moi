import type { LyraDatabase } from "./database.js";

interface SettingRow {
  value_json: string;
}

export class AppSettingsRepository {
  readonly #database: LyraDatabase;

  constructor(database: LyraDatabase) {
    this.#database = database;
  }

  get(key: string): unknown | null {
    const row = this.#database.connection
      .prepare("SELECT value_json FROM app_settings WHERE key = ?")
      .get(key) as SettingRow | undefined;
    return row ? (JSON.parse(row.value_json) as unknown) : null;
  }

  set(key: string, value: unknown): void {
    const valueJson = JSON.stringify(value);
    if (valueJson === undefined) throw new Error("App setting value must be JSON serializable.");
    this.#database.connection
      .prepare(`
        INSERT INTO app_settings (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `)
      .run(key, valueJson, new Date().toISOString());
  }

  delete(key: string): void {
    this.#database.connection.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
  }
}
