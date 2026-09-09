import { MOUSE } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** OrbitControls swaps PAN and ROTATE when a modifier is pressed. */
export function configureOrbitMouse(controls: OrbitControls, event?: Pick<PointerEvent, "shiftKey" | "ctrlKey" | "metaKey">): void {
  const modified = event?.shiftKey || event?.ctrlKey || event?.metaKey;
  controls.mouseButtons.LEFT = modified ? MOUSE.PAN : MOUSE.ROTATE;
  controls.mouseButtons.MIDDLE = modified ? MOUSE.ROTATE : MOUSE.PAN;
  controls.mouseButtons.RIGHT = null;
}
