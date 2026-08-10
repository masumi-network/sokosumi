"use client";

/**
 * Loading + Thinking primitives adapted from Beautiful UI
 * (https://beautiful-ui-five.vercel.app/ — Loading State / Thinking · Reasoning).
 * Tokens remapped to Sokosumi semantic colors.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Beautiful UI loading timer: tenths under 60s, then `m s.s`. */
export function formatBeautifulElapsed(elapsedMs: number): string {
  const total = Math.max(0, elapsedMs) / 1000;
  if (total < 60) {
    return `${total.toFixed(1)}s`;
  }
  const minutes = Math.floor(total / 60);
  const rem = total % 60;
  return `${minutes}m ${rem.toFixed(1)}s`;
}

/**
 * Beautiful UI Drive (chevron wavefront left → right).
 * Demo uses 90ms step / 650ms cycle; we use slower timings for chat.
 */
const DRIVE_CYCLE_MS = 1000;
const DRIVE_DELAY_STEP_MS = 140;
const DRIVE_PIXEL_DELAYS_MS = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3);
  const col = i % 3;
  return (col + Math.abs(row - 1)) * DRIVE_DELAY_STEP_MS;
});

/**
 * Sample Beautiful UI `pixel-on` opacity curve at phase [0, 1).
 * 0–18% rise, 18–42% hold bright, 42–62% fall, 62–100% dim.
 */
export function drivePixelOpacityAtPhase(phase01: number): number {
  const p = ((phase01 % 1) + 1) % 1;
  const dim = 0.15;
  const bright = 1;
  if (p < 0.18) {
    return dim + (bright - dim) * (p / 0.18);
  }
  if (p < 0.42) {
    return bright;
  }
  if (p < 0.62) {
    return bright + (dim - bright) * ((p - 0.42) / 0.2);
  }
  return dim;
}

/** Opacity for one Drive cell given elapsed animation time and cell delay. */
export function drivePixelOpacity(
  elapsedMs: number,
  delayMs: number,
  cycleMs = DRIVE_CYCLE_MS,
): number {
  const t = (((elapsedMs - delayMs) % cycleMs) + cycleMs) % cycleMs;
  return drivePixelOpacityAtPhase(t / cycleMs);
}

function useAnimationClockMs(): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    // Respect reduced motion: freeze grid at dim (no wave).
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      setElapsedMs(now - start);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return elapsedMs;
}

function useLiveElapsedMs(startedAtMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, now - startedAtMs);
}

/** 3×3 Drive wave — JS-driven so it does not depend on CSS keyframes. */
function DrivePixelGrid() {
  const elapsedMs = useAnimationClockMs();
  return (
    <span aria-hidden className="bui-pixel-grid" data-testid="bui-drive-grid">
      {DRIVE_PIXEL_DELAYS_MS.map((delayMs, i) => (
        <span
          key={i}
          className="bui-pixel-cell"
          style={{ opacity: drivePixelOpacity(elapsedMs, delayMs) }}
          data-testid="bui-drive-pixel"
        />
      ))}
    </span>
  );
}

/**
 * Pixel-grid loader + shimmer label + live elapsed (Beautiful UI Loading State).
 * Used for mention thinking + stream overlay waiting states.
 */
export function CoworkerLoadingState({
  label,
  startedAtMs,
  className,
}: {
  label: string;
  startedAtMs: number;
  className?: string;
}) {
  const elapsedMs = useLiveElapsedMs(startedAtMs);
  return (
    <div
      className={cn("flex w-fit max-w-full items-center gap-2.5", className)}
      role="status"
      aria-live="polite"
      data-testid="coworker-loading-state"
    >
      <DrivePixelGrid />
      <span
        className="bui-shimmer-text truncate text-sm font-medium"
        data-testid="coworker-loading-label"
      >
        {label}
      </span>
      <span
        className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums"
        data-testid="live-stream-elapsed"
      >
        {formatBeautifulElapsed(elapsedMs)}
      </span>
    </div>
  );
}

/** Static dim Drive grid — same footprint as loading, no motion. */
function StaticPixelGrid() {
  return (
    <span aria-hidden className="bui-pixel-grid" data-testid="bui-static-grid">
      {DRIVE_PIXEL_DELAYS_MS.map((_, i) => (
        <span
          key={i}
          className="bui-pixel-cell"
          style={{ opacity: 0.15 }}
          data-testid="bui-static-pixel"
        />
      ))}
    </span>
  );
}

/**
 * Terminal mention status in the same layout as loading (static grid + label).
 * `responded` / `failed` after the live thinking row.
 */
export function CoworkerMentionTerminalStatus({
  label,
  variant,
  className,
}: {
  label: string;
  variant: "responded" | "failed";
  className?: string;
}) {
  return (
    <div
      className={cn("flex w-fit max-w-full items-center gap-2.5", className)}
      data-testid="coworker-mention-terminal"
      data-variant={variant}
    >
      <StaticPixelGrid />
      <span
        className={cn(
          "truncate text-sm font-medium",
          variant === "failed" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Expandable Thought header + optional prose body (Beautiful UI Thinking · Reasoning).
 * - Live: working shimmer "Thinking" + optional live beat in expanded body
 * - Done: "Thought for Ns" settled label + full Thought text
 */
export function CoworkerThoughtTrace({
  working,
  headerLabel,
  bodyText,
  defaultExpanded = false,
  className,
}: {
  working: boolean;
  headerLabel: string;
  bodyText?: string | null;
  defaultExpanded?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const traceRef = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(0);
  const hasBody = Boolean(bodyText?.trim());

  useLayoutEffect(() => {
    if (traceRef.current) {
      setLineHeight(traceRef.current.offsetHeight);
    }
  }, [expanded, bodyText, working]);

  return (
    <div
      className={cn("flex w-full min-w-0 flex-col", className)}
      data-testid="coworker-thought-trace"
      data-working={working ? "true" : "false"}
    >
      <button
        type="button"
        aria-expanded={hasBody ? expanded : undefined}
        disabled={!hasBody}
        onClick={() => {
          if (hasBody) {
            setExpanded((value) => !value);
          }
        }}
        className={cn(
          "-mx-1.5 flex w-fit max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-left",
          "transition-colors duration-100",
          hasBody &&
            "hover:bg-muted/60 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          !hasBody && "cursor-default",
        )}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          aria-hidden
          className="shrink-0"
          fill={
            working
              ? "var(--muted-foreground)"
              : "color-mix(in oklab, var(--muted-foreground) 70%, transparent)"
          }
        >
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        {working ? (
          <span className="bui-shimmer-text truncate text-sm font-medium whitespace-nowrap">
            {headerLabel}
          </span>
        ) : (
          <span className="text-muted-foreground truncate text-sm font-medium whitespace-nowrap">
            {headerLabel}
          </span>
        )}
        {hasBody ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="text-muted-foreground shrink-0 transition-transform duration-300"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        ) : null}
      </button>

      {hasBody ? (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-400"
          style={{
            gridTemplateRows: expanded ? "1fr" : "0fr",
            opacity: expanded ? 1 : 0,
            transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
          }}
          // Keep body out of a11y tree when collapsed (still animates open/closed).
          inert={!expanded ? true : undefined}
          aria-hidden={!expanded}
        >
          <div className="overflow-hidden">
            <div className="relative mt-1 ml-[5px] pl-4">
              <span
                aria-hidden
                className="bg-border absolute left-[3px] w-px"
                style={{
                  top: -8,
                  height: lineHeight ? lineHeight - 2 : 0,
                  transition: "height 500ms cubic-bezier(0.23,1,0.32,1)",
                }}
              />
              <div ref={traceRef} className="flex flex-col gap-1 py-1">
                <p
                  className={cn(
                    "text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap",
                    // Spec: clamp live beat so multi-reader rooms do not flood.
                    working && "line-clamp-3",
                  )}
                  data-testid="coworker-thought-body"
                >
                  {bodyText}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Live stream: loading grid when no beat yet; otherwise working Thought
 * header with live beat as expandable body (default open).
 */
export function CoworkerLiveThought({
  label,
  liveBeat,
  startedAtMs,
}: {
  label: string;
  liveBeat: string | null;
  startedAtMs: number;
}) {
  if (!liveBeat) {
    return <CoworkerLoadingState label={label} startedAtMs={startedAtMs} />;
  }
  return (
    <div
      className="flex min-w-0 flex-col gap-1"
      role="status"
      aria-live="polite"
    >
      <CoworkerThoughtTrace
        working
        headerLabel={label}
        bodyText={liveBeat}
        defaultExpanded
      />
      <span
        className="text-muted-foreground ml-[26px] font-mono text-xs tabular-nums"
        data-testid="live-stream-elapsed"
      >
        <LiveElapsed startedAtMs={startedAtMs} />
      </span>
    </div>
  );
}

function LiveElapsed({ startedAtMs }: { startedAtMs: number }) {
  const elapsedMs = useLiveElapsedMs(startedAtMs);
  return <>{formatBeautifulElapsed(elapsedMs)}</>;
}
