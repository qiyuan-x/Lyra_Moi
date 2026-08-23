import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { createPortal } from "react-dom";
import type { PromptTemplateSnapshot } from "@lyra/contracts";
import { Icon } from "./Icon.js";

interface PromptTemplatePickerProps {
  templates: PromptTemplateSnapshot[];
  onSelect: (content: string) => void;
  buttonClassName?: string;
  placement?: "top" | "bottom";
  secondaryText?: (template: PromptTemplateSnapshot) => string;
}

export function PromptTemplatePicker(props: PromptTemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 8;
      const width = Math.min(352, window.innerWidth - viewportPadding * 2);
      const left = Math.max(
        viewportPadding,
        Math.min(rect.right - width, window.innerWidth - width - viewportPadding)
      );
      const placement = props.placement ?? "bottom";
      setPosition({
        width,
        left,
        ...(placement === "top"
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 })
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, props.placement]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      if (!(event.target instanceof Node)) return;
      if (
        !triggerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={props.buttonClassName ?? "button button-quiet"}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="prompt" size={15} />
        提示词库
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="prompt-template-popover"
          role="listbox"
          aria-label="提示词库"
          style={position}
        >
          {props.templates.length === 0 ? (
            <p>提示词库中暂无模板</p>
          ) : props.templates.map((template) => (
            <button
              type="button"
              role="option"
              aria-selected="false"
              key={template.id}
              title={template.content}
              onClick={() => {
                props.onSelect(template.content);
                setOpen(false);
              }}
            >
              <strong>{template.name}</strong>
              <span>{props.secondaryText?.(template) ?? template.content}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
