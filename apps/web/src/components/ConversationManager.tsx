import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ConversationSnapshot } from "@lyra/contracts";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { FloatingMenu } from "./FloatingMenu.js";
import { Icon } from "./Icon.js";

interface ConversationManagerProps {
  conversations: ConversationSnapshot[];
  currentId: string;
  busy: boolean;
  onCreate: () => void;
  onSelect: (conversationId: string) => void;
  onRename: (conversationId: string, title: string) => Promise<void>;
  onDelete: (conversationId: string) => Promise<void>;
}

export function ConversationManager(props: ConversationManagerProps) {
  const [editing, setEditing] = useState<ConversationSnapshot | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<ConversationSnapshot | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionAnchor, setActionAnchor] = useState<HTMLElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const current = props.conversations.find(
    (conversation) => conversation.id === props.currentId
  );
  const actionConversation = props.conversations.find(
    (conversation) => conversation.id === actionId
  );

  function closeActions() {
    setActionId(null);
    setActionAnchor(null);
  }

  useEffect(() => {
    if (!dropdownOpen) return;
    const closeDropdown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".floating-menu")
      ) {
        return;
      }
      if (
        event.target instanceof Node &&
        !dropdownRef.current?.contains(event.target)
      ) {
        setDropdownOpen(false);
        setEditing(null);
        closeActions();
      }
    };
    document.addEventListener("pointerdown", closeDropdown);
    return () => document.removeEventListener("pointerdown", closeDropdown);
  }, [dropdownOpen]);

  function beginRename(conversation: ConversationSnapshot) {
    setEditing(conversation);
    setTitle(conversation.title || "新对话");
    closeActions();
  }

  function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!editing || !title.trim() || props.busy) return;
    void props.onRename(editing.id, title.trim()).then(() => setEditing(null));
  }

  return (
    <>
      <div className="conversation-manager" ref={dropdownRef}>
        <button
          type="button"
          className="conversation-manager-trigger"
          aria-haspopup="listbox"
          aria-expanded={dropdownOpen}
          title={current?.title || "对话列表"}
          onClick={() => setDropdownOpen((open) => !open)}
        >
          <Icon name="chat" size={16} />
          <span>
            <small>{current ? "当前对话" : "未保存"}</small>
            <strong>{current?.title || "新对话"}</strong>
          </span>
          <Icon name="chevron" size={14} />
        </button>
        <button
          type="button"
          className="button button-secondary conversation-manager-create"
          disabled={props.busy}
          onClick={() => {
            setDropdownOpen(false);
            closeActions();
            props.onCreate();
          }}
        >
          <Icon name="plus" size={14} />
          新建对话
        </button>

        {dropdownOpen && (
          <div className="conversation-manager-menu" role="listbox" aria-label="对话列表">
            <header>
              <strong>对话列表</strong>
              <span>{props.conversations.length}</span>
            </header>
            <div className="conversation-manager-list">
              {props.conversations.length === 0 ? (
                <p>还没有对话</p>
              ) : props.conversations.map((conversation) => (
                <article
                  className={conversation.id === props.currentId ? "active" : ""}
                  key={conversation.id}
                >
                  {editing?.id === conversation.id ? (
                    <form onSubmit={submitRename}>
                      <input
                        aria-label="对话名称"
                        value={title}
                        maxLength={200}
                        autoFocus
                        onChange={(event) => setTitle(event.target.value)}
                      />
                      <button type="submit" className="icon-button" aria-label="保存对话名称" disabled={props.busy || !title.trim()}>
                        <Icon name="confirm" size={15} />
                      </button>
                      <button type="button" className="icon-button" aria-label="取消重命名" onClick={() => setEditing(null)}>
                        <Icon name="close" size={14} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="conversation-manager-open"
                        onClick={() => {
                          props.onSelect(conversation.id);
                          setDropdownOpen(false);
                          closeActions();
                        }}
                      >
                        <strong title={conversation.title || "新对话"}>{conversation.title || "新对话"}</strong>
                        <span>{formatDate(conversation.updatedAt)}</span>
                      </button>
                      <button
                        type="button"
                        className="icon-button conversation-manager-more"
                        title="对话操作"
                        aria-label={`${conversation.title || "新对话"}的操作`}
                        aria-expanded={actionId === conversation.id}
                        onClick={(event) => {
                          if (actionId === conversation.id) {
                            closeActions();
                          } else {
                            setActionId(conversation.id);
                            setActionAnchor(event.currentTarget);
                          }
                        }}
                      >
                        <Icon name="more" size={15} />
                      </button>
                    </>
                  )}
                </article>
              ))}
            </div>
          </div>
        )}
      </div>

      <FloatingMenu
        open={Boolean(actionConversation)}
        anchor={actionAnchor}
        label="对话操作"
        onClose={closeActions}
      >
        {actionConversation && (
          <>
            <button type="button" role="menuitem" onClick={() => beginRename(actionConversation)}>
              <Icon name="manual" size={15} />重命名
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                closeActions();
                setDeleting(actionConversation);
              }}
            >
              <Icon name="trash" size={15} />删除
            </button>
          </>
        )}
      </FloatingMenu>

      {deleting && (
        <ConfirmDialog
          title="删除对话"
          text={`确认删除“${deleting.title || "新对话"}”？对话消息和 Agent 执行记录会被删除，已生成的图片、模型和文件会保留。`}
          confirmText="确认删除"
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
