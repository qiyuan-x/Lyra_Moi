import { Icon } from "../components/Icon.js";
import { navigation, type Page } from "./app-navigation.js";

interface AppSidebarProps {
  page: Page;
  collapsed: boolean;
  onPageChange: (page: Page) => void;
  onToggleCollapsed: () => void;
}

export function AppSidebar(props: AppSidebarProps) {
  return (
    <aside className={`main-sidebar${props.collapsed ? " collapsed" : ""}`}>
      <div className="brand">
        <img src="/icons/lyra-64.png" alt="" width="32" height="32" />
        <strong>Lyra</strong>
        <button
          type="button"
          className="sidebar-collapse-button"
          aria-label={props.collapsed ? "展开主菜单" : "收起主菜单"}
          title={props.collapsed ? "展开主菜单" : "收起主菜单"}
          onClick={props.onToggleCollapsed}
        >
          <Icon name="chevron" size={18} />
          <span>{props.collapsed ? "展开" : "收起"}</span>
        </button>
      </div>
      <nav>
        {navigation.map((item) => (
          <button
            type="button"
            className={props.page === item.page ? "active" : ""}
            key={item.page}
            onClick={() => props.onPageChange(item.page)}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
