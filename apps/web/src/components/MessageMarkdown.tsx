import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  return <div className="message-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt }) => <span>{alt || "图片"}</span>
  }}>{text}</Markdown></div>;
});
