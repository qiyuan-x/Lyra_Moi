import { Icon } from "./Icon.js";

interface ConfirmDialogProps {
  title: string;
  text: string;
  confirmText?: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <div
        className="form-modal confirm-modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div><strong>{props.title}</strong></div>
          <button type="button" className="icon-button" onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="form-body"><p>{props.text}</p></div>
        <footer>
          <button type="button" className="button button-secondary" onClick={props.onClose}>取消</button>
          <button
            type="button"
            className="button button-danger"
            disabled={props.busy}
            onClick={() => void props.onConfirm()}
          >
            {props.busy ? "处理中" : props.confirmText ?? "确认删除"}
          </button>
        </footer>
      </div>
    </div>
  );
}
