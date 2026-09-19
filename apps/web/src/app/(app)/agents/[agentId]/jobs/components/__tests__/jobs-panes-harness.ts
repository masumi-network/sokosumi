import { JOBS_PANES_ATTRIBUTE } from "@/app/agents/[agentId]/jobs/components/use-jobs-two-pane-fit";

/**
 * Stands in for the jobs panes row so `useJobsTwoPaneFit` has something to
 * measure: a row element plus a `ResizeObserver` that reports the width the
 * test sets rather than the zero every element has in happy-dom.
 *
 * Call `cleanup()` in `afterEach`; wrap `setWidth` in `act` when a test resizes
 * after render.
 */
export function installJobsPanesRow(initialWidth: number) {
  const row = document.createElement("div");
  row.setAttribute(JOBS_PANES_ATTRIBUTE, "");
  document.body.append(row);

  let width = initialWidth;
  const observers = new Map<ResizeObserver, ResizeObserverCallback>();
  const originalResizeObserver = window.ResizeObserver;

  function report(observer: ResizeObserver, callback: ResizeObserverCallback) {
    callback([{ contentRect: { width } } as ResizeObserverEntry], observer);
  }

  class HarnessResizeObserver implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}

    observe() {
      observers.set(this, this.callback);
      report(this, this.callback);
    }

    unobserve() {
      observers.delete(this);
    }

    disconnect() {
      observers.delete(this);
    }
  }

  window.ResizeObserver = HarnessResizeObserver;

  return {
    setWidth(nextWidth: number) {
      width = nextWidth;
      for (const [observer, callback] of observers) {
        report(observer, callback);
      }
    },
    cleanup() {
      window.ResizeObserver = originalResizeObserver;
      observers.clear();
      row.remove();
    },
  };
}
