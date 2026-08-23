import {
  useState,
  type FormEvent
} from "react";
import type { ConversationSnapshot } from "@lyra/contracts";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { FloatingMenu } from "../../components/FloatingMenu.js";
import { Icon } from "../../components/Icon.js";

interface SidebarConversationListProps {
  conversations: ConversationSnapshot[];
  currentId: string;
  draftActive: boolean;
  busy: boolean;
  onCreate: () => void;
  onSelect: (conversationId: string) => void;
  onRename: (conversationId: string, title: string) => Promise<void>;
  onDelete: (conversationId: string) => Promise<void>;
}

export function SidebarConversationList(props: SidebarConversationListProps) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState<ConversationSnapshot | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<ConversationSnapshot | null>(null);
  const menuConversation = props.conversations.find(
    (conversation) => conversation.id === menuId
  );

  function closeMenu() {
    setMenuId(null);
    setMenuAnchor(null);
  }

  function beginRename(conversation: ConversationSnapshot) {
    setEditing(conversation);
    setTitle(conversation.title || "新对话");
    closeMenu();
  }

  function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!editing || !title.trim() || props.busy) return;
    void props.onRename(editing.id, title.trim()).then(() => setEditing(null));
  }

  return (
    <div className="sidebar-conversation-subtree">
      <button
        type="button"
        className={`sidebar-new-conversation${props.draftActive ? " active" : ""}`}
        disabled={props.busy}
        onClick={() => {
          closeMenu();
          props.onCreate();
        }}
      >
        <Icon name="plus" size={16} />
        <span>新对话</span>
      </button>

      <div className="sidebar-conversation-tree">
        <div className="sidebar-conversation-list" aria-label="对话列表">
          {props.conversations.length === 0 ? (
            <span className="sidebar-conversation-empty">还没有对话</span>
          ) : props.conversations.map((conversation) => (
            <div
              className={`sidebar-conversation-item${conversation.id === props.currentId ? " active" : ""}`}
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
                  <button type="submit" aria-label="保存对话名称" disabled={props.busy || !title.trim()}>
                    <Icon name="confirm" size={14} />
                  </button>
                  <button type="button" aria-label="取消重命名" onClick={() => setEditing(null)}>
                    <Icon name="close" size={13} />
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="sidebar-conversation-open"
                    title={conversation.title || "新对话"}
                    onClick={() => {
                      closeMenu();
                      props.onSelect(conversation.id);
                    }}
                  >
                    <span>{conversation.title || "新对话"}</span>
                  </button>
                  <button
                    type="button"
                    className="sidebar-conversation-more"
                    title="对话操作"
                    aria-label={`${conversation.title || "新对话"}的操作`}
                    aria-expanded={menuId === conversation.id}
                    onClick={(event) => {
                      if (menuId === conversation.id) {
                        closeMenu();
                      } else {
                        setMenuId(conversation.id);
                        setMenuAnchor(event.currentTarget);
                      }
                    }}
                  >
                    <Icon name="more" size={15} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <FloatingMenu
        open={Boolean(menuConversation)}
        anchor={menuAnchor}
        label="对话操作"
        onClose={closeMenu}
      >
        {menuConversation && (
          <>
            <button type="button" role="menuitem" onClick={() => beginRename(menuConversation)}>
              <Icon name="manual" size={15} />重命名
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                closeMenu();
                setDeleting(menuConversation);
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
          }}
        />
      )}
    </div>
  );
}
