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

export type OverlayPart = { box: OverlayRect; included: boolean };

type OverlayField = {
  box: OverlayInput;
  componentBoxes?: readonly OverlayInput[];
  componentCells?: readonly { box: OverlayInput; included: boolean }[];
};

/**
 * What to draw for a field the underwriter has selected.
 *
 * A figure summed from several rows is mapped to the union of those rows, and
 * that rectangle also covers rows between them the sum leaves out — an
 * employer-paid life premium between two base rows, an overtime premium
 * between regular and holiday pay. Drawing the union alone claims the whole
 * block, so the amount cannot be checked against the document without
 * re-adding the column by hand.
 *
 * When the parser reports the cells its box covers, every one is returned with
 * whether the figure counts it, so the viewer can rule the column into rows
 * and shade only the counted ones. Otherwise this is the field's own box.
 */
export function selectedOverlayParts(field: OverlayField): OverlayPart[] {
  if (field.componentCells?.length) {
    return field.componentCells.map((cell) => ({ box: asOverlayRect(cell.box), included: cell.included }));
  }
  if (field.componentBoxes?.length) {
    return field.componentBoxes.map((box) => ({ box: asOverlayRect(box), included: true }));
  }
  return [{ box: asOverlayRect(field.box), included: true }];
}

/** Grow a mapped box just enough for the stroke to clear the printed figure. */
export function padOverlayBox(box: OverlayInput): OverlayRect {
  const unit = overlayUnit(box);
  const rect = asOverlayRect(box);
  // Padding is proportional so a small cell gets a visible stroke, but it has
  // to be capped. A Schedule E address is a full-width row, and 8% of that is
  // ~7% of the page on each side, which stretched the highlight across the
  // A/B/C columns and made one property look like all three.
  const clamp = (value: number, low: number, high: number) =>
    Math.min(Math.max(value, low), high);
  const padX = clamp(rect.w * 0.08, unit === 1 ? 0.004 : 0.4, unit === 1 ? 0.02 : 2);
  const padY = clamp(rect.h * 0.12, unit === 1 ? 0.002 : 0.2, unit === 1 ? 0.01 : 1);
  const x = Math.max(0, rect.x - padX);
  const y = Math.max(0, rect.y - padY);
  return {
    x,
    y,
    w: Math.min(unit - x, rect.w + padX * 2),
    h: Math.min(unit - y, rect.h + padY * 2),
  };
}
