import type { ConversationSnapshot } from "@lyra/contracts";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon.js";
import { ApplicationUpdateControl } from "../components/ApplicationUpdateControl.js";
import { SidebarConversationList } from "../features/conversations/SidebarConversationList.js";
import type { ApiClient } from "../lib/api-client.js";
import { navigationGroups, toolNavigation, type Page } from "./app-navigation.js";

interface AppSidebarProps {
  api: ApiClient;
  page: Page;
  collapsed: boolean;
  conversations: ConversationSnapshot[];
  conversationId: string;
  conversationDraftActive: boolean;
  conversationBusy: boolean;
  onPageChange: (page: Page) => void;
  onToggleCollapsed: () => void;
  onCreateConversation: () => void;
  onConversationSelect: (conversationId: string) => void;
  onConversationRename: (conversationId: string, title: string) => Promise<void>;
  onConversationDelete: (conversationId: string) => Promise<void>;
}

export function AppSidebar(props: AppSidebarProps) {
  const [toolsOpen, setToolsOpen] = useState(
    () => props.page === "pose" && !window.matchMedia("(max-width: 40rem)").matches
  );
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toolsOpen) return;
    const close = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) setToolsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [toolsOpen]);

  return (
    <aside className={`main-sidebar${props.collapsed ? " collapsed" : ""}`}>
      <div className="brand">
        <img src="/icons/lyra-64.png" alt="" width="32" height="32" />
        <div className="brand-copy">
          <strong>Lyra</strong>
          <ApplicationUpdateControl api={props.api} collapsed={props.collapsed} />
        </div>
        <button
          type="button"
          className="sidebar-collapse-button"
          aria-label={props.collapsed ? "展开主菜单" : "收起主菜单"}
          title={props.collapsed ? "展开主菜单" : "收起主菜单"}
          onClick={props.onToggleCollapsed}
        >
          <Icon name="sidebar" size={18} />
        </button>
      </div>
      <nav className="sidebar-navigation">
        {navigationGroups.map((group) => (
          <div
            className={`sidebar-navigation-group position-${group.position}`}
            key={group.id}
          >
            {group.items.map((item) => (
              <button
                type="button"
                className={props.page === item.page ? "active" : ""}
                key={item.page}
                onClick={() => {
                  setToolsOpen(false);
                  props.onPageChange(item.page);
                }}
              >
                <Icon name={item.icon} size={20} />
                <span>{item.label}</span>
              </button>
            ))}
            {group.id === "creation" && (
              <div className={`sidebar-tool-group${toolsOpen ? " open" : ""}`} ref={toolsRef}>
                <button
                  type="button"
                  className={`sidebar-tool-trigger${props.page === "pose" ? " active" : ""}`}
                  aria-expanded={toolsOpen}
                  title={props.collapsed ? toolNavigation.label : undefined}
                  onClick={() => {
                    if (props.collapsed && !window.matchMedia("(max-width: 40rem)").matches) {
                      props.onPageChange("pose");
                      return;
                    }
                    setToolsOpen((open) => !open);
                  }}
                >
                  <Icon name={toolNavigation.icon} size={20} />
                  <span>{toolNavigation.label}</span>
                  <Icon name="chevron" size={14} />
                </button>
                {toolsOpen && (
                  <div className="sidebar-tool-children">
                    {toolNavigation.items.map((item) => (
                      <button
                        type="button"
                        className={props.page === item.page ? "active" : ""}
                        key={item.page}
                        onClick={() => {
                          props.onPageChange(item.page);
                          if (window.matchMedia("(max-width: 40rem)").matches) setToolsOpen(false);
                        }}
                      >
                        <Icon name={item.icon} size={17} />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {group.id === "conversation" && !props.collapsed && (
              <SidebarConversationList
                conversations={props.conversations}
                currentId={props.conversationId}
                draftActive={props.page === "conversation" && props.conversationDraftActive}
                busy={props.conversationBusy}
                onCreate={() => {
                  props.onPageChange("conversation");
                  props.onCreateConversation();
                }}
                onSelect={(conversationId) => {
                  props.onConversationSelect(conversationId);
                  props.onPageChange("conversation");
                }}
                onRename={props.onConversationRename}
                onDelete={props.onConversationDelete}
              />
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}
