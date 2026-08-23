import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

interface FloatingMenuProps {
  open: boolean;
  anchor: HTMLElement | null;
  label: string;
  children: ReactNode;
  onClose: () => void;
}

interface MenuPosition {
  top: number;
  left: number;
  ready: boolean;
}

const viewportGap = 8;
const anchorGap = 6;

export function FloatingMenu(props: FloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onClose);
  const [position, setPosition] = useState<MenuPosition>({
    top: 0,
    left: 0,
    ready: false
  });

  useLayoutEffect(() => {
    onCloseRef.current = props.onClose;
  }, [props.onClose]);

  useLayoutEffect(() => {
    if (!props.open || !props.anchor || !menuRef.current) return;
    const menu = menuRef.current;

    function placeMenu() {
      if (!props.anchor || !menuRef.current) return;
      const anchorRect = props.anchor.getBoundingClientRect();
      const menuRect = menuRef.current.getBoundingClientRect();
      const left = Math.min(
        window.innerWidth - menuRect.width - viewportGap,
        Math.max(viewportGap, anchorRect.right - menuRect.width)
      );
      const below = anchorRect.bottom + anchorGap;
      const above = anchorRect.top - menuRect.height - anchorGap;
      const top = below + menuRect.height <= window.innerHeight - viewportGap
        ? below
        : Math.max(viewportGap, above);
      setPosition({ top, left, ready: true });
    }

    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menu.contains(event.target) || props.anchor?.contains(event.target)) return;
      onCloseRef.current();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    const closeOnScroll = () => onCloseRef.current();

    placeMenu();
    menu.querySelector<HTMLElement>("button:not(:disabled), a[href]")?.focus();
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", placeMenu);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", placeMenu);
    };
  }, [props.anchor, props.open]);

  if (!props.open || !props.anchor) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="floating-menu"
      role="menu"
      aria-label={props.label}
      style={{
        top: position.top,
        left: position.left,
        visibility: position.ready ? "visible" : "hidden"
      }}
    >
      {props.children}
    </div>,
    document.body
  );
}
