import { useRef, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { useDialogKeyboard } from "../../lib/use-dialog-keyboard.js";

export function PromptImagePreviewDialog(props: { url: string; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  useDialogKeyboard(dialog, props.onClose);
  function resize(delta: number) {
    setZoom((value) => {
      const next = Math.min(4, Math.max(0.5, Math.round((value + delta) * 100) / 100));
      if (next <= 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  }
  function resetView() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }
  function stopDragging(event?: React.PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (event && current?.pointerId === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
    setDragging(false);
  }
  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <div ref={dialog} className="image-modal prompt-image-modal" role="dialog" aria-modal="true" aria-label={props.title} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <strong>{props.title}</strong>
          <div className="image-modal-actions">
            <button type="button" className="icon-button" aria-label="缩小图片" disabled={zoom <= 0.5} onClick={() => resize(-0.25)}><Icon name="minus" size={17} /></button>
            <button type="button" className="icon-button" aria-label="复位图片视图" disabled={zoom === 1 && offset.x === 0 && offset.y === 0} onClick={resetView}><Icon name="retry" size={17} /></button>
            <button type="button" className="icon-button" aria-label="放大图片" disabled={zoom >= 4} onClick={() => resize(0.25)}><Icon name="plus" size={17} /></button>
            <button type="button" className="icon-button" aria-label="关闭图片预览" onClick={props.onClose}><Icon name="close" size={19} /></button>
          </div>
        </header>
        <div className={`image-modal-viewport${zoom > 1 ? " zoomable" : ""}${dragging ? " is-dragging" : ""}`}
          onWheel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            resize(event.deltaY < 0 ? 0.15 : -0.15);
          }}
          onPointerDown={(event) => {
            if (zoom <= 1) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              offsetX: offset.x,
              offsetY: offset.y
            };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (!current || current.pointerId !== event.pointerId) return;
            setOffset({
              x: current.offsetX + event.clientX - current.startX,
              y: current.offsetY + event.clientY - current.startY
            });
          }}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
        >
          <img src={props.url} alt={props.title} draggable={false} style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }} />
        </div>
      </div>
    </div>
  );
}
