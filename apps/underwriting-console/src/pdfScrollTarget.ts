import type { OverlayRect as Box } from './overlayBox';

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where to scroll a PDF pane so `box` (normalized 0..1, top-left origin) sits
 * centred in it.
 *
 * Page position is taken from bounding rects relative to the scroll pane, not
 * `offsetTop`. The pane is not a positioned element, so a page's `offsetTop`
 * is measured from some outer ancestor and includes the toolbar and header
 * above the pane. That inflated the target and left the view at the bottom of
 * the page instead of on the highlighted box.
 */
export function pdfScrollTarget(
  pane: Rect & { scrollTop: number; scrollLeft: number },
  page: Rect,
  box: Box | null,
  gapPx = 12,
): { top: number; left: number } {
  const pageTop = pane.scrollTop + (page.top - pane.top);
  const pageLeft = pane.scrollLeft + (page.left - pane.left);
  if (!box) return { top: Math.max(0, pageTop - gapPx), left: Math.max(0, pane.scrollLeft) };
  const top = pageTop + (box.y + box.h / 2) * page.height - pane.height / 2;
  const left = pageLeft + (box.x + box.w / 2) * page.width - pane.width / 2;
  return { top: Math.max(0, top), left: Math.max(0, left) };
}
