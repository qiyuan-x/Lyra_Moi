import { useEffect, useState, type FormEvent } from "react";
import type { ProjectSnapshot } from "@lyra/contracts";
import { Icon } from "./Icon.js";

interface ProjectManagerDialogProps {
  projects: ProjectSnapshot[];
  currentId: string;
  busy: boolean;
  initialCreating?: boolean;
  onClose: () => void;
  onSelect: (projectId: string) => void;
  onCreate: (input: { name: string; description: string }) => Promise<void>;
  onUpdate: (projectId: string, input: { name: string; description: string }) => Promise<void>;
  onArchive: (projectId: string) => Promise<void>;
}

export function ProjectManagerDialog(props: ProjectManagerDialogProps) {
  const [editingId, setEditingId] = useState<string | null>(
    props.initialCreating ? null : props.currentId || null
  );
  const [creating, setCreating] = useState(Boolean(props.initialCreating));
  const selected = props.projects.find((project) => project.id === editingId) ?? null;
  const [name, setName] = useState(selected?.name ?? "");
  const [description, setDescription] = useState(selected?.description ?? "");

  useEffect(() => {
    setName(selected?.name ?? "");
    setDescription(selected?.description ?? "");
  }, [selected?.description, selected?.id, selected?.name]);

  function startCreate() {
    setCreating(true);
    setEditingId(null);
    setName("");
    setDescription("");
  }

  function edit(project: ProjectSnapshot) {
    setCreating(false);
    setEditingId(project.id);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    if (creating) {
      void props.onCreate({ name: name.trim(), description: description.trim() });
    } else if (selected) {
      void props.onUpdate(selected.id, { name: name.trim(), description: description.trim() });
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <div className="project-manager" role="dialog" aria-modal="true" aria-label="项目管理" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><strong>项目管理</strong><span>项目之间的对话、任务和图片互相隔离</span></div>
          <button type="button" className="icon-button" aria-label="关闭项目管理" onClick={props.onClose}><Icon name="close" size={18} /></button>
        </header>
        <div className="project-manager-body">
          <aside>
            <button type="button" className="button button-primary project-create-button" onClick={startCreate}>
              <Icon name="plus" size={16} />新建项目
            </button>
            <div className="project-list">
              {props.projects.map((project) => (
                <button
                  type="button"
                  className={project.id === editingId && !creating ? "active" : ""}
                  key={project.id}
                  onClick={() => edit(project)}
                >
                  <strong title={project.name}>{project.name}</strong>
                  <span title={project.description || undefined}>{project.id === props.currentId ? "当前项目" : project.description || "无描述"}</span>
                </button>
              ))}
            </div>
          </aside>
          <form onSubmit={submit}>
            <div className="project-form-heading">
              <strong>{creating ? "新建项目" : "项目信息"}</strong>
              {!creating && selected && selected.id !== props.currentId && (
                <button type="button" className="button button-secondary" onClick={() => props.onSelect(selected.id)}>切换到此项目</button>
              )}
            </div>
            <label className="field"><span>项目名称</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoFocus /></label>
            <label className="field"><span>项目描述</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={5} /></label>
            <div className="project-form-actions">
              {!creating && selected && (
                <button
                  type="button"
                  className="button button-danger"
                  disabled={props.busy || props.projects.length <= 1}
                  onClick={() => void props.onArchive(selected.id)}
                >
                  归档项目
                </button>
              )}
              <button type="submit" className="button button-primary" disabled={props.busy || !name.trim()}>
                {props.busy ? "处理中" : creating ? "创建项目" : "保存修改"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
