import type { ProjectGenerationForms } from "@lyra/contracts";

type Section = keyof ProjectGenerationForms;
interface FormApi {
  getGenerationForms(projectId: string): Promise<ProjectGenerationForms>;
  updateGenerationForms(projectId: string, forms: ProjectGenerationForms): Promise<ProjectGenerationForms>;
}
interface Entry {
  forms: ProjectGenerationForms;
  pending: ProjectGenerationForms;
  api: FormApi;
  reportError: (error: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
  saving?: Promise<void>;
}
const entries = new Map<string, Entry>();
const loading = new Map<string, Promise<void>>();
const keys = { modeling: "lyra.modeling.state.", image: "lyra.image-generation.form." };
const pendingKey = (projectId: string) => `lyra.generation.pending.${projectId}`;

/** Server values win over legacy browser values; unsaved edits remain recoverable. */
export async function hydrateProjectForms(projectId: string, api: FormApi, reportError: (error: unknown) => void): Promise<void> {
  let pending = loading.get(projectId);
  if (!pending) {
    pending = loadProjectForms(projectId, api, reportError);
    loading.set(projectId, pending);
  }
  try { await pending; } finally { if (loading.get(projectId) === pending) loading.delete(projectId); }
}

async function loadProjectForms(projectId: string, api: FormApi, reportError: (error: unknown) => void): Promise<void> {
  await flushProjectForms(projectId);
  const forms = await api.getGenerationForms(projectId);
  const patch: ProjectGenerationForms = {};
  const unsaved = readLocal(pendingKey(projectId));
  for (const section of ["modeling", "image"] as const) {
    const value = readRecord(unsaved?.[section]) ?? (forms[section] === undefined ? readLocal(keys[section] + projectId) : null);
    if (value) patch[section] = value;
  }
  const resolved = Object.keys(patch).length ? await api.updateGenerationForms(projectId, patch) : forms;
  entries.set(projectId, { forms: resolved, pending: {}, api, reportError });
  for (const section of ["modeling", "image"] as const) {
    if (resolved[section]) writeLocal(keys[section] + projectId, resolved[section]);
  }
  writeLocal(pendingKey(projectId), {});
}

export function readProjectForm(projectId: string, section: Section): Record<string, unknown> | null {
  const value = entries.get(projectId)?.forms[section] ?? readLocal(keys[section] + projectId);
  return value ? structuredClone(value) : null;
}

export function saveProjectForm(projectId: string, section: Section, value: Record<string, unknown>): void {
  writeLocal(keys[section] + projectId, value);
  const entry = entries.get(projectId);
  if (!entry || JSON.stringify(entry.forms[section]) === JSON.stringify(value)) return;
  const snapshot = structuredClone(value);
  entry.forms = { ...entry.forms, [section]: snapshot };
  entry.pending = { ...entry.pending, [section]: snapshot };
  // Keep uncommitted edits across page closes and failed requests.
  writeLocal(pendingKey(projectId), { ...readLocal(pendingKey(projectId)), [section]: value });
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    delete entry.timer;
    void flushProjectForms(projectId).catch((error) => entry.reportError(new Error(
      `项目生成参数保存失败：${error instanceof Error ? error.message : String(error)}`
    )));
  }, 250);
}

export async function flushProjectForms(projectId: string): Promise<void> {
  const entry = entries.get(projectId);
  if (!entry) return;
  if (entry.timer) { clearTimeout(entry.timer); delete entry.timer; }
  if (entry.saving) return entry.saving;
  entry.saving = (async () => {
    while (Object.keys(entry.pending).length) {
      const patch = entry.pending;
      entry.pending = {};
      try {
        await entry.api.updateGenerationForms(projectId, patch);
        writeLocal(pendingKey(projectId), entry.pending);
      } catch (error) {
        entry.pending = { ...patch, ...entry.pending };
        throw error;
      }
    }
  })();
  try { await entry.saving; } finally { delete entry.saving; }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function readLocal(key: string): Record<string, unknown> | null {
  try { return readRecord(JSON.parse(localStorage.getItem(key) ?? "null")); } catch { return null; }
}
function writeLocal(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* The project file is the primary store. */ }
}
