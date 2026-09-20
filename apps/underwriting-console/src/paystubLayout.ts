/**
 * Shared layout for the demo earnings statement. generatePaystubPdf draws
 * with these numbers; the income workspace paints highlight boxes from the
 * same numbers so Inspect Coordinates lands on the printed figure.
 *
 * PDFKit origin is top-left, same as the pdf.js canvas overlay.
 */
export const PAYSTUB_PAGE = { width: 612, height: 792, margin: 40 };

export const PAYSTUB_HEADER_H = 86;
export const PAYSTUB_INFO_TOP = 102;
export const PAYSTUB_INFO_ROW_H = 16;
export const PAYSTUB_INFO_ROWS = 4;
export const PAYSTUB_EARNINGS_GAP = 30;
export const PAYSTUB_SECTION_H = 22;
export const PAYSTUB_LINE_H = 17;

/** Label, Rate, Hours, Current, YTD */
export const PAYSTUB_COL = [40, 250, 330, 415, 500] as const;
export const PAYSTUB_COL_W = 74;

export const PAYSTUB_EARNINGS_HEADER_Y =
  PAYSTUB_INFO_TOP + PAYSTUB_INFO_ROWS * PAYSTUB_INFO_ROW_H + PAYSTUB_EARNINGS_GAP;
export const PAYSTUB_REGULAR_Y = PAYSTUB_EARNINGS_HEADER_Y + PAYSTUB_SECTION_H;
export const PAYSTUB_OVERTIME_Y = PAYSTUB_REGULAR_Y + PAYSTUB_LINE_H;
export const PAYSTUB_BONUS_Y = PAYSTUB_OVERTIME_Y + PAYSTUB_LINE_H;
export const PAYSTUB_GROSS_Y = PAYSTUB_BONUS_Y + PAYSTUB_LINE_H;

export type PaystubBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
};

function pct(x: number, y: number, w: number, h: number): PaystubBox {
  return {
    x: (x / PAYSTUB_PAGE.width) * 100,
    y: (y / PAYSTUB_PAGE.height) * 100,
    width: (w / PAYSTUB_PAGE.width) * 100,
    height: (h / PAYSTUB_PAGE.height) * 100,
    page: 1,
  };
}

const CELL_H = 15;
const INFO_VALUE_LEFT = PAYSTUB_PAGE.margin + 90;
const INFO_VALUE_RIGHT = 418;
const INFO_VALUE_W = 154;

function infoRowY(index: number): number {
  return PAYSTUB_INFO_TOP + index * PAYSTUB_INFO_ROW_H - 2;
}

/** Overlay boxes in page-percent, keyed by workspace field id. */
export const PAYSTUB_HIGHLIGHT_BOXES: Record<string, PaystubBox> = {
  'ps-emp-name': pct(PAYSTUB_PAGE.margin, 16, 340, 24),
  'ps-ee-name': pct(INFO_VALUE_LEFT - 2, infoRowY(0), 190, CELL_H),
  'ps-period': pct(INFO_VALUE_RIGHT, infoRowY(0), INFO_VALUE_W, CELL_H),
  'ps-frequency': pct(INFO_VALUE_RIGHT, infoRowY(2), INFO_VALUE_W, CELL_H),
  // Weekly hours live on the Base rate row ("$45.00 / hr · 40 hr/wk"), not period hours.
  'ps-hours-week': pct(INFO_VALUE_RIGHT, infoRowY(3), INFO_VALUE_W, CELL_H),
  'ps-hourly-rate': pct(PAYSTUB_COL[1] - 2, PAYSTUB_REGULAR_Y - 2, PAYSTUB_COL_W, CELL_H),
  'ps-current-base': pct(PAYSTUB_COL[3] - 2, PAYSTUB_REGULAR_Y - 2, PAYSTUB_COL_W, CELL_H),
  'ps-base-ytd': pct(PAYSTUB_COL[4] - 2, PAYSTUB_REGULAR_Y - 2, PAYSTUB_COL_W, CELL_H),
  'ps-ot-ytd': pct(PAYSTUB_COL[4] - 2, PAYSTUB_OVERTIME_Y - 2, PAYSTUB_COL_W, CELL_H),
  'ps-bonus-ytd': pct(PAYSTUB_COL[4] - 2, PAYSTUB_BONUS_Y - 2, PAYSTUB_COL_W, CELL_H),
  'ps-gross-ytd': pct(PAYSTUB_COL[4] - 2, PAYSTUB_GROSS_Y - 2, PAYSTUB_COL_W, CELL_H),
};
