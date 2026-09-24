import { useEffect } from 'react';

/**
 * Stop the scroll wheel from editing focused number inputs.
 *
 * A focused `<input type="number">` treats a wheel event as a spinner step, so
 * scrolling the page with the cursor over a field silently rewrites it. On an
 * income worksheet that is a figure changed without anyone touching it, and
 * nothing on screen says it happened.
 *
 * The field is blurred rather than the event cancelled, so the page keeps
 * scrolling normally. Cancelling instead would trap the scroll whenever the
 * cursor passed over a focused input.
 *
 * Mounted once at the app shell so it covers every number input, including
 * ones added later.
 */
export function useNumberInputWheelGuard(): void {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const active = document.activeElement;
      if (
        !(active instanceof HTMLInputElement) ||
        active.type !== 'number' ||
        !(event.target === active || active.contains(event.target as Node))
      ) {
        return;
      }

      // Cancel this tick, then drop focus. Blurring alone is not enough: the
      // browser has already decided to treat the event as a spinner step by
      // the time the handler runs, so the value still changes. Cancelling
      // stops that, and the blur means the next tick is no longer over a
      // focused number input, so the page scrolls normally from there.
      event.preventDefault();
      active.blur();
    };

    // Capture phase, and non-passive so preventDefault is honoured.
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => document.removeEventListener('wheel', onWheel, { capture: true });
  }, []);
}
