import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icon.js";

export function useAppNotice() {
  const [notice, setNotice] = useState<{ type: string; text: string } | null>(null);
  const pushNotice = useCallback((type: string, text: string) => {
    if (!text.trim()) return;
    setNotice((current) => current?.type === type && current.text === text ? current : { type, text });
  }, []);
  const reportError = useCallback((error: unknown) => {
    pushNotice("error", error instanceof Error ? error.message : String(error));
  }, [pushNotice]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.type === "error" ? 8000 : 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const noticeElement = notice && <div className={`app-notice app-notice-${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
    <span>{notice.text}</span>
    <button type="button" className="icon-button" aria-label="关闭通知" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button>
  </div>;
  return { pushNotice, reportError, noticeElement };
}
