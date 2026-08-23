import { Icon } from "./Icon.js";

interface CommunityPageProps {
  url: string;
  onOpenSettings: () => void;
}

export function CommunityPage({ url, onOpenSettings }: CommunityPageProps) {
  const communityUrl = url.trim();

  if (!communityUrl) {
    return (
      <section className="community-page community-page-empty">
        <Icon name="community" size={34} />
        <h1>社区</h1>
        <p>请先在设置中配置社区网址</p>
        <button type="button" className="button button-primary" onClick={onOpenSettings}>
          前往设置
        </button>
      </section>
    );
  }

  return (
    <section className="community-page">
      <header className="community-page-header">
        <div>
          <strong>Lyra 社区</strong>
          <span>{communityUrl}</span>
        </div>
        <button
          type="button"
          className="button button-secondary"
          title="在新窗口打开社区"
          onClick={() => window.open(communityUrl, "_blank", "noopener,noreferrer")}
        >
          在新窗口打开 ↗
        </button>
      </header>
      <div className="community-frame-shell">
        <iframe
          className="community-frame"
          src={communityUrl}
          title="Lyra 社区"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </section>
  );
}
