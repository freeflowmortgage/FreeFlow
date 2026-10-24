import { useEffect } from 'react';

/** The focused field when it is a number input, which is the only one that steps. */
function focusedNumberInput(): HTMLInputElement | null {
  const active = document.activeElement;
  return active instanceof HTMLInputElement && active.type === 'number' ? active : null;
}

/**
 * Stop the scroll wheel and the arrow keys from stepping focused number inputs.
 *
 * A focused `<input type="number">` treats both a wheel tick and Up/Down as a
 * spinner step, so scrolling the page with the cursor over a field, or nudging
 * an arrow key while reading, silently rewrites it. On an income worksheet that
 * is a figure changed without anyone typing, and nothing on screen says it
 * happened.
 *
 * Only the stepping affordances are taken. Typing still reaches the field, and
 * Left/Right still move the caret.
 *
 * Mounted once in `main.tsx`, above the runtime app, so it covers every number
 * input in every build mode, including inputs added later.
 */
export function useNumberInputStepGuard(): void {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const input = focusedNumberInput();
      if (!input || !(event.target === input || input.contains(event.target as Node))) return;

      // Cancel this tick, then drop focus. Blurring alone is not enough: the
      // browser has already decided to treat the event as a spinner step by
      // the time the handler runs, so the value still changes. Cancelling
      // stops that, and the blur means the next tick is no longer over a
      // focused number input, so the page scrolls normally from there.
      event.preventDefault();
      input.blur();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const input = focusedNumberInput();
      if (!input || event.target !== input) return;

      // Cancelled but not blurred: the underwriter is working in this field,
      // so taking focus away mid-entry would be worse than the stray step.
      event.preventDefault();
    };

    // Capture phase, and non-passive so preventDefault is honoured.
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      document.removeEventListener('wheel', onWheel, { capture: true });
      document.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, []);
}
