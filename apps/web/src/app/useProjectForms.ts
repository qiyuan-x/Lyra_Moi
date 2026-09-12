import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../lib/api-client.js";
import { flushProjectForms, hydrateProjectForms } from "../features/generation/project-form-state.js";

export function useProjectForms(projectId: string, api: ApiClient, reportError: (error: unknown) => void) {
  const [loadedProject, setLoadedProject] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    setLoadedProject("");
    setError("");
    if (!projectId) return;
    void hydrateProjectForms(projectId, api, reportError).then(() => {
      if (!cancelled) setLoadedProject(projectId);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    const flush = () => { void flushProjectForms(projectId).catch(reportError); };
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", flush);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", flush);
      flush();
    };
  }, [projectId, api, reportError, attempt]);
  return { ready: Boolean(projectId) && loadedProject === projectId, error, retry };
}
