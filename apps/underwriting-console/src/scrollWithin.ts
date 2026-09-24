/**
 * Scroll an element into view inside its own scrollable pane only.
 *
 * `Element.scrollIntoView` walks every scrollable ancestor up to the document,
 * so bringing a field into view in one pane also repositions the page. In the
 * split view that moved the QA panel back to the top whenever a field was
 * clicked, which is disorienting once the list is longer than the viewport.
 *
 * This finds the nearest ancestor that actually scrolls and moves only that
 * one, leaving the rest of the layout where the underwriter left it.
 */
function nearestScrollable(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const scrolls = /auto|scroll|overlay/.test(`${style.overflowY} ${style.overflowX}`);
    if (scrolls && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function scrollIntoViewWithin(element: HTMLElement | null | undefined): void {
  if (!element) return;
  const pane = nearestScrollable(element);
  if (!pane) return;

  const paneBox = pane.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  const fullyVisible =
    box.top >= paneBox.top &&
    box.bottom <= paneBox.bottom &&
    box.left >= paneBox.left &&
    box.right <= paneBox.right;
  if (fullyVisible) return;

  pane.scrollTo({
    top: Math.max(0, pane.scrollTop + (box.top - paneBox.top) - (paneBox.height - box.height) / 2),
    left: Math.max(0, pane.scrollLeft + (box.left - paneBox.left) - (paneBox.width - box.width) / 2),
    behavior: 'smooth',
  });
}
