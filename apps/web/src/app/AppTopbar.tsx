import type {
  ProjectSnapshot
} from "@lyra/contracts";
import { ProjectSwitcher } from "../features/projects/ProjectSwitcher.js";
import { navigation, type Page } from "./app-navigation.js";

interface AppTopbarProps {
  page: Page;
  projects: ProjectSnapshot[];
  projectId: string;
  onProjectSelect: (projectId: string) => void;
  onProjectCreate: () => void;
  onProjectManage: () => void;
}

export function AppTopbar(props: AppTopbarProps) {
  const pageLabel = navigation.find((item) => item.page === props.page)?.label;
  return (
    <header className="topbar">
      <div className="topbar-project">
        <ProjectSwitcher
          projects={props.projects}
          currentId={props.projectId}
          onSelect={props.onProjectSelect}
          onCreate={props.onProjectCreate}
          onManage={props.onProjectManage}
        />
      </div>
      <strong className="topbar-page-title">{pageLabel}</strong>
      <div className="topbar-end" aria-hidden="true" />
    </header>
  );
}
