export async function toggleViewerFullscreen(container: HTMLElement): Promise<void> {
  const document = container.ownerDocument;
  if (document.fullscreenElement === container) {
    await document.exitFullscreen();
  } else {
    await container.requestFullscreen();
  }
}
