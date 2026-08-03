import type { DatabaseMigration } from "../migration-runner.js";

export const initialSchemaMigration: DatabaseMigration = {
  version: 1,
  name: "initial_schema",
  sql: String.raw`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      last_image_mode TEXT NOT NULL DEFAULT 'agent'
        CHECK (last_image_mode IN ('agent', 'manual')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    ) STRICT;

    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    ) STRICT;
    CREATE INDEX conversations_project_updated_idx
      ON conversations(project_id, updated_at DESC);

    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'model', 'file')),
      source TEXT NOT NULL CHECK (source IN ('upload', 'generated')),
      name TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT NOT NULL,
      blob_key TEXT NOT NULL,
      checksum_sha256 TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
      width INTEGER CHECK (width IS NULL OR width > 0),
      height INTEGER CHECK (height IS NULL OR height > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    ) STRICT;
    CREATE INDEX assets_project_created_idx ON assets(project_id, created_at DESC);
    CREATE INDEX assets_checksum_idx ON assets(checksum_sha256);
    CREATE INDEX assets_blob_key_idx ON assets(blob_key);

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
      text TEXT NOT NULL,
      reply_to_id TEXT REFERENCES messages(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX messages_conversation_created_idx
      ON messages(conversation_id, created_at);

    CREATE TABLE message_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL CHECK (position >= 1),
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (message_id, position)
    ) STRICT;
    CREATE INDEX message_attachments_asset_idx ON message_attachments(asset_id);

    CREATE TABLE asset_tags (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (asset_id, tag)
    ) STRICT;

    CREATE TABLE prompt_templates (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      shortcut TEXT,
      content TEXT NOT NULL,
      variables_json TEXT CHECK (variables_json IS NULL OR json_valid(variables_json)),
      favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    ) STRICT;
    CREATE INDEX prompt_templates_project_updated_idx
      ON prompt_templates(project_id, updated_at DESC);

    CREATE TABLE provider_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL
        CHECK (protocol IN ('openai', 'gemini', 'openai-compatible')),
      base_url TEXT NOT NULL DEFAULT '',
      api_key_env TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    ) STRICT;

    CREATE TABLE provider_models (
      id TEXT PRIMARY KEY,
      provider_profile_id TEXT NOT NULL
        REFERENCES provider_profiles(id) ON DELETE RESTRICT,
      service_type TEXT NOT NULL CHECK (service_type IN ('llm', 'image', 'model')),
      remote_model_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      settings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (provider_profile_id, service_type, remote_model_id)
    ) STRICT;
    CREATE UNIQUE INDEX provider_models_one_default_idx
      ON provider_models(provider_profile_id, service_type)
      WHERE is_default = 1;

    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
      request_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK (status IN (
        'queued', 'thinking', 'calling_tool', 'waiting_tool', 'resuming',
        'awaiting_user', 'completed', 'failed', 'cancelled', 'interrupted'
      )),
      llm_provider_profile_id TEXT NOT NULL
        REFERENCES provider_profiles(id) ON DELETE RESTRICT,
      llm_provider_model_id TEXT NOT NULL
        REFERENCES provider_models(id) ON DELETE RESTRICT,
      default_image_profile_id TEXT
        REFERENCES provider_profiles(id) ON DELETE RESTRICT,
      default_image_model_id TEXT
        REFERENCES provider_models(id) ON DELETE RESTRICT,
      system_prompt_version TEXT NOT NULL,
      max_tool_calls INTEGER NOT NULL CHECK (max_tool_calls >= 1),
      tool_call_count INTEGER NOT NULL DEFAULT 0 CHECK (tool_call_count >= 0),
      current_step INTEGER NOT NULL DEFAULT 0 CHECK (current_step >= 0),
      cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
      locked_by TEXT,
      locked_at TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    ) STRICT;
    CREATE INDEX agent_runs_status_created_idx ON agent_runs(status, created_at);
    CREATE INDEX agent_runs_conversation_created_idx
      ON agent_runs(conversation_id, created_at);

    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE RESTRICT,
      agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE RESTRICT,
      agent_step_id TEXT REFERENCES agent_steps(id) ON DELETE RESTRICT,
      request_message_id TEXT REFERENCES messages(id) ON DELETE RESTRICT,
      source TEXT NOT NULL CHECK (source IN ('agent', 'manual')),
      kind TEXT NOT NULL CHECK (kind IN ('image.generate', 'model.generate')),
      status TEXT NOT NULL CHECK (status IN (
        'queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'
      )),
      title TEXT NOT NULL,
      stage TEXT NOT NULL,
      provider_profile_id TEXT NOT NULL
        REFERENCES provider_profiles(id) ON DELETE RESTRICT,
      provider_model_id TEXT NOT NULL
        REFERENCES provider_models(id) ON DELETE RESTRICT,
      prompt TEXT NOT NULL,
      request_json TEXT NOT NULL CHECK (json_valid(request_json)),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      error_code TEXT,
      error_message TEXT,
      cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
      attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
      locked_by TEXT,
      locked_at TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX jobs_status_created_idx ON jobs(status, created_at);
    CREATE INDEX jobs_project_created_idx ON jobs(project_id, created_at DESC);
    CREATE INDEX jobs_agent_run_created_idx ON jobs(agent_run_id, created_at);

    CREATE TABLE agent_steps (
      id TEXT PRIMARY KEY,
      agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT,
      sequence INTEGER NOT NULL CHECK (sequence >= 1),
      type TEXT NOT NULL CHECK (type IN (
        'llm_request', 'llm_response', 'tool_call', 'tool_result',
        'user_input_request', 'user_input_result', 'final_message'
      )),
      status TEXT NOT NULL CHECK (status IN (
        'pending', 'running', 'waiting', 'completed', 'failed'
      )),
      tool_name TEXT,
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      child_job_id TEXT REFERENCES jobs(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (agent_run_id, sequence)
    ) STRICT;
    CREATE INDEX agent_steps_child_job_idx ON agent_steps(child_job_id);

    CREATE TABLE job_inputs (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL CHECK (position >= 1),
      label TEXT NOT NULL,
      PRIMARY KEY (job_id, position)
    ) STRICT;
    CREATE INDEX job_inputs_asset_idx ON job_inputs(asset_id);

    CREATE TABLE job_outputs (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL CHECK (position >= 1),
      PRIMARY KEY (job_id, position)
    ) STRICT;
    CREATE INDEX job_outputs_asset_idx ON job_outputs(asset_id);

    CREATE TABLE runtime_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE RESTRICT,
      agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE RESTRICT,
      job_id TEXT REFERENCES jobs(id) ON DELETE RESTRICT,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX runtime_events_project_id_idx ON runtime_events(project_id, id);
    CREATE INDEX runtime_events_agent_run_id_idx ON runtime_events(agent_run_id, id);
    CREATE INDEX runtime_events_job_id_idx ON runtime_events(job_id, id);

    CREATE TABLE worker_instances (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('combined', 'agent', 'image')),
      version TEXT NOT NULL,
      pid INTEGER CHECK (pid IS NULL OR pid > 0),
      started_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      stopped_at TEXT
    ) STRICT;
    CREATE INDEX worker_instances_heartbeat_idx ON worker_instances(heartbeat_at DESC);

    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL CHECK (json_valid(value_json)),
      updated_at TEXT NOT NULL
    ) STRICT;
  `
};
