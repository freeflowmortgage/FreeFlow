/** Shared inspect-overlay geometry for every income PDF (W-2, paystub, schedules, K-1). */

export type OverlayRect = { x: number; y: number; w: number; h: number };

type OverlayInput = {
  x: number;
  y: number;
  w?: number;
  width?: number;
  h?: number;
  height?: number;
};

function overlayUnit(box: OverlayInput): 1 | 100 {
  const width = box.w ?? box.width ?? 0;
  const height = box.h ?? box.height ?? 0;
  return Math.max(box.x, box.y, width, height) <= 1.05 ? 1 : 100;
}

export function asOverlayRect(box: OverlayInput): OverlayRect {
  return {
    x: box.x,
    y: box.y,
    w: box.w ?? box.width ?? 0,
    h: box.h ?? box.height ?? 0,
  };
}

export function isUsableOverlayBox(box: OverlayInput): boolean {
  const rect = asOverlayRect(box);
  const min = overlayUnit(box) === 1 ? 0.004 : 0.4;
  return rect.w > min && rect.h > min;
}

/** Grow a mapped box just enough for the stroke to clear the printed figure. */
export function padOverlayBox(box: OverlayInput): OverlayRect {
  const unit = overlayUnit(box);
  const rect = asOverlayRect(box);
  const padX = Math.max(unit === 1 ? 0.004 : 0.4, rect.w * 0.08);
  const padY = Math.max(unit === 1 ? 0.002 : 0.2, rect.h * 0.12);
  const x = Math.max(0, rect.x - padX);
  const y = Math.max(0, rect.y - padY);
  return {
    x,
    y,
    w: Math.min(unit - x, rect.w + padX * 2),
    h: Math.min(unit - y, rect.h + padY * 2),
  };
}
