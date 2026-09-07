export interface TaskRuntimeSettings {
  modelGenerationConcurrency: number;
}

export type UpdateTaskRuntimeSettingsRequestBody =
  Partial<TaskRuntimeSettings>;

export interface TaskRuntimeSettingsSnapshot {
  settings: TaskRuntimeSettings;
  defaults: TaskRuntimeSettings;
}
