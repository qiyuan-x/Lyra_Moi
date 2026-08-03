import { useEffect } from "react";
import { Icon } from "./Icon.js";

export type NoticeType = "info" | "success" | "error";

export interface NoticeItem {
  id: number;
  type: NoticeType;
  text: string;
}

interface NoticeCenterProps {
  items: NoticeItem[];
  onDismiss: (id: number) => void;
}

export function NoticeCenter(props: NoticeCenterProps) {
  return (
    <div className="notice-center" aria-label="操作通知">
      {props.items.map((item) => (
        <Notice key={item.id} item={item} onDismiss={props.onDismiss} />
      ))}
    </div>
  );
}

function Notice(props: { item: NoticeItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const delay = props.item.type === "error" ? 10_000 : 4_000;
    const timer = window.setTimeout(() => props.onDismiss(props.item.id), delay);
    return () => window.clearTimeout(timer);
  }, [props.item.id, props.item.type, props.onDismiss]);

  const title = props.item.type === "error"
    ? "操作失败"
    : props.item.type === "success"
      ? "操作完成"
      : "提示";

  return (
    <article className={`notice notice-${props.item.type}`} role={props.item.type === "error" ? "alert" : "status"}>
      <div>
        <strong>{title}</strong>
        <p>{props.item.text}</p>
      </div>
      <button type="button" className="icon-button" aria-label="关闭通知" onClick={() => props.onDismiss(props.item.id)}>
        <Icon name="close" size={15} />
      </button>
    </article>
  );
}
