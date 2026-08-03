interface IconProps {
  name: IconName;
  size?: number;
}

export type IconName =
  | "image"
  | "cube"
  | "library"
  | "prompt"
  | "settings"
  | "tasks"
  | "plus"
  | "send"
  | "close"
  | "retry"
  | "stop"
  | "chat"
  | "manual"
  | "confirm"
  | "trash"
  | "more"
  | "chevron"
  | "expand"
  | "download"
  | "display"
  | "wireframe"
  | "sun"
  | "star";

const paths: Record<IconName, React.ReactNode> = {
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 4 4 3-3 4 4"/></>,
  cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v9"/></>,
  library: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18M12 7h5M12 11h5"/></>,
  prompt: <><path d="M4 5h16v12H8l-4 4z"/><path d="M8 9h8M8 13h5"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7-.7-2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7-2 .7v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7z"/></>,
  tasks: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h4"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  send: <><path d="m3 11 18-8-8 18-2-8z"/><path d="m11 13 5-5"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  retry: <><path d="M20 11a8 8 0 1 0-2 5.5"/><path d="M20 4v7h-7"/></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
  chat: <><path d="M4 5h16v12H9l-5 4z"/><path d="M8 10h8M8 14h5"/></>,
  manual: <><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10z"/><path d="m13.5 7 3.5 3.5M14 4l2-2 4 4-2 2"/></>,
  confirm: <path d="m5 12 4 4L19 6"/>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  chevron: <path d="m9 6 6 6-6 6"/>,
  expand: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 20h14"/></>,
  display: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  wireframe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></>,
  sun: <><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>
};

export function Icon({ name, size = 20 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
