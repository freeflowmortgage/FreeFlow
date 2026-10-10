import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfScrollTarget } from './pdfScrollTarget';

// Pane sits 180px down the window under the toolbar; page 2 starts 1000px into the content.
const pane = { top: 180, left: 40, width: 600, height: 500, scrollTop: 0, scrollLeft: 0 };

test('centres the highlighted box, independent of where the pane sits in the layout', () => {
  const page = { top: 180 + 1000, left: 40 + 12, width: 576, height: 800 };
  const box = { x: 0.1, y: 0.25, w: 0.2, h: 0.05 };
  const { top, left } = pdfScrollTarget(pane, page, box);
  // Box centre is at content y = 1000 + 0.275*800 = 1220; centred → 1220 - 250.
  assert.equal(top, 970);
  // Box centre x = 12 + 0.2*576 = 127.2 → 127.2 - 300 < 0 → clamp.
  assert.equal(left, 0);
  // After scrolling, box centre lands at pane middle.
  const centreOnScreen = page.top - top + (box.y + box.h / 2) * page.height;
  assert.equal(centreOnScreen - pane.top, pane.height / 2);
});

test('accounts for current scroll and zoomed page size', () => {
  const scrolled = { ...pane, scrollTop: 400, scrollLeft: 300 };
  const page = { top: 180 + 600 - 400, left: 40 + 12 - 300, width: 1152, height: 1600 };
  const box = { x: 0.8, y: 0.5, w: 0.1, h: 0.02 };
  const { top, left } = pdfScrollTarget(scrolled, page, box);
  assert.equal(top, 600 + 0.51 * 1600 - 250);
  assert.ok(Math.abs(left - (12 + 0.85 * 1152 - 300)) < 1e-9);
});

test('without a box, aligns the page top under the gap', () => {
  const page = { top: 180 + 1000, left: 52, width: 576, height: 800 };
  assert.deepEqual(pdfScrollTarget(pane, page, null, 12), { top: 988, left: 0 });
});
