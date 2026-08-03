import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ConversationSnapshot } from "@lyra/contracts";
import { ConfirmDialog } from "./AssetLibraryPage.js";
import { Icon } from "./Icon.js";

interface ConversationBarProps {
  conversations: ConversationSnapshot[];
  currentId: string;
  busy: boolean;
  activeJobCount: number;
  onCreateTask: () => void;
  onOpenTasks: () => void;
  onSelect: (conversationId: string) => void;
  onRename: (conversationId: string, title: string) => Promise<void>;
  onDelete: (conversationId: string) => Promise<void>;
}

export function ConversationBar(props: ConversationBarProps) {
  const [editing, setEditing] = useState<ConversationSnapshot | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<ConversationSnapshot | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const current = props.conversations.find((conversation) => conversation.id === props.currentId);

  useEffect(() => {
    const closeDropdown = (event: PointerEvent) => {
      const dropdown = dropdownRef.current;
      if (dropdownOpen && dropdown && event.target instanceof Node && !dropdown.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeDropdown);
    return () => document.removeEventListener("pointerdown", closeDropdown);
  }, [dropdownOpen]);

  function beginRename(conversation: ConversationSnapshot) {
    setEditing(conversation);
    setTitle(conversation.title || "新对话");
  }

  function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!editing || !title.trim() || props.busy) return;
    void props.onRename(editing.id, title.trim()).then(() => setEditing(null));
  }

  return (
    <>
      <section className="conversation-bar" aria-label="对话列表">
        <header>
          <div className="conversation-bar-title">
            <strong>对话</strong>
            <span>{props.conversations.length}</span>
          </div>
          <div className="conversation-bar-header-actions">
            <div className="conversation-dropdown" ref={dropdownRef}>
              <button
                type="button"
                className="conversation-select-trigger"
                aria-haspopup="listbox"
                aria-expanded={dropdownOpen}
                title={current?.title}
                onClick={() => setDropdownOpen((open) => !open)}
              >
                <span>{current?.title || "请选择对话"}</span>
                <Icon name="chevron" size={15} />
              </button>
              {dropdownOpen && (
                <div className="conversation-dropdown-menu" role="listbox" aria-label="选择对话">
                  {props.conversations.length === 0 ? (
                    <p>还没有对话</p>
                  ) : props.conversations.map((conversation) => (
                    <article className={conversation.id === props.currentId ? "active" : ""} key={conversation.id}>
                      {editing?.id === conversation.id ? (
                        <form onSubmit={submitRename}>
                          <input aria-label="对话名称" value={title} maxLength={200} autoFocus onChange={(event) => setTitle(event.target.value)} />
                          <button type="submit" className="icon-button" aria-label="保存对话名称" disabled={props.busy || !title.trim()}><Icon name="confirm" size={15} /></button>
                          <button type="button" className="icon-button" aria-label="取消重命名" onClick={() => setEditing(null)}><Icon name="close" size={14} /></button>
                        </form>
                      ) : (
                        <>
                          <button type="button" className="conversation-dropdown-open" onClick={() => { props.onSelect(conversation.id); setDropdownOpen(false); }}>
                            <strong title={conversation.title || "新对话"}>{conversation.title || "新对话"}</strong>
                            <span>{formatDate(conversation.updatedAt)}</span>
                          </button>
                          <div className="conversation-bar-actions">
                            <button type="button" className="icon-button" title="重命名对话" aria-label={`重命名 ${conversation.title || "新对话"}`} onClick={() => beginRename(conversation)}><Icon name="manual" size={14} /></button>
                            <button type="button" className="icon-button danger-button" title="删除对话" aria-label={`删除 ${conversation.title || "新对话"}`} onClick={() => setDeleting(conversation)}><Icon name="trash" size={14} /></button>
                          </div>
                        </>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="button button-primary" onClick={props.onCreateTask}>
              <Icon name="plus" size={14} />新建任务
            </button>
            <button type="button" className="task-button conversation-task-button" onClick={props.onOpenTasks}>
              <Icon name="tasks" size={15} />
              <span>任务</span>
              {props.activeJobCount > 0 && <b>{props.activeJobCount}</b>}
            </button>
          </div>
        </header>
      </section>

      {deleting && (
        <ConfirmDialog
          title="删除对话"
          text={`确认删除“${deleting.title || "新对话"}”？该对话及其历史消息将不再显示。`}
          busy={props.busy}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await props.onDelete(deleting.id);
            setDeleting(null);
            setDropdownOpen(false);
          }}
        />
      )}
    </>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
