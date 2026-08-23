import { useEffect, useRef, useState } from "react";
import type { ProjectSnapshot } from "@lyra/contracts";
import { Icon } from "../../components/Icon.js";

interface ProjectSwitcherProps {
  projects: ProjectSnapshot[];
  currentId: string;
  onSelect: (projectId: string) => void;
  onCreate: () => void;
  onManage: () => void;
}

export function ProjectSwitcher(props: ProjectSwitcherProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const current = props.projects.find((project) => project.id === props.currentId);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="project-switcher" ref={rootRef}>
      <button
        type="button"
        className="project-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={current?.name}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{current?.name ?? "选择项目"}</span>
        <Icon name="chevron" size={16} />
      </button>
      {open && (
        <div className="project-switcher-menu" role="menu">
          <div>
            {props.projects.map((project) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={project.id === props.currentId}
                className={project.id === props.currentId ? "active" : ""}
                key={project.id}
                onClick={() => {
                  props.onSelect(project.id);
                  setOpen(false);
                }}
              >
                <span title={project.name}>{project.name}</span>
                {project.id === props.currentId && <Icon name="confirm" size={15} />}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="project-switcher-create"
            onClick={() => {
              setOpen(false);
              props.onCreate();
            }}
          >
            <Icon name="plus" size={16} />
            新建项目
          </button>
        </div>
      )}
      <button
        type="button"
        className="button button-secondary project-settings-button"
        aria-label="项目设置"
        title="项目设置"
        onClick={props.onManage}
      >
        <Icon name="settings" size={15} />
        <span>项目设置</span>
      </button>
    </div>
  );
}
