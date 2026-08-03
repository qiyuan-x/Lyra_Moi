import {
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import type { ProjectSnapshot } from "@lyra/contracts";
import type { ApiClient } from "../lib/api-client.js";

interface UseProjectActionsOptions {
  api: ApiClient;
  projects: ProjectSnapshot[];
  projectId: string;
  setProjects: Dispatch<SetStateAction<ProjectSnapshot[]>>;
  setProjectId: Dispatch<SetStateAction<string>>;
  closeManager: () => void;
  onNotice: (text: string) => void;
  onError: (error: unknown) => void;
}

export function useProjectActions(options: UseProjectActionsOptions) {
  const [busy, setBusy] = useState(false);

  async function createProject(input: {
    name: string;
    description: string;
  }) {
    setBusy(true);
    try {
      const created = await options.api.createProject(input);
      options.setProjects((current) => [created, ...current]);
      options.setProjectId(created.id);
      options.closeManager();
      options.onNotice(`已创建项目“${created.name}”`);
    } catch (error) {
      options.onError(error);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function updateProject(
    projectId: string,
    input: { name: string; description: string }
  ) {
    setBusy(true);
    try {
      const updated = await options.api.updateProject(projectId, input);
      options.setProjects((current) =>
        replaceProject(current, updated)
      );
      options.onNotice("项目信息已更新");
    } catch (error) {
      options.onError(error);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function archiveProject(projectId: string) {
    setBusy(true);
    try {
      await options.api.archiveProject(projectId);
      const result = removeProject(
        options.projects,
        options.projectId,
        projectId
      );
      options.setProjects(result.projects);
      if (result.projectId !== options.projectId) {
        options.setProjectId(result.projectId);
      }
      options.closeManager();
      options.onNotice("项目已归档");
    } catch (error) {
      options.onError(error);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  return {
    projectBusy: busy,
    createProject,
    updateProject,
    archiveProject
  };
}

export function replaceProject(
  projects: ProjectSnapshot[],
  replacement: ProjectSnapshot
): ProjectSnapshot[] {
  return projects.map((project) =>
    project.id === replacement.id ? replacement : project
  );
}

export function removeProject(
  projects: ProjectSnapshot[],
  currentProjectId: string,
  removedProjectId: string
): {
  projects: ProjectSnapshot[];
  projectId: string;
} {
  const remaining = projects.filter(
    (project) => project.id !== removedProjectId
  );
  return {
    projects: remaining,
    projectId: currentProjectId === removedProjectId
      ? remaining[0]?.id ?? ""
      : currentProjectId
  };
}
