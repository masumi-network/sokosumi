"use client";

/**
 * Loading + Thinking primitives adapted from Beautiful UI
 * (https://beautiful-ui-five.vercel.app/ — Loading State / Thinking · Reasoning).
 * Tokens remapped to Sokosumi semantic colors.
 */

import { CircleAlert } from "lucide-react";
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

/**
 * Deterministic first paint (SSR/client match), then live clock after mount.
 * Seeding with `startedAtMs` yields 0.0s until the effect runs.
 */
function useLiveElapsedMs(startedAtMs: number): number {
  const [now, setNow] = useState(startedAtMs);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [startedAtMs]);
  return Math.max(0, now - startedAtMs);
}

/**
 * 3×3 Drive wave — rAF updates pixel opacity via refs (no React setState per frame).
 */
function DrivePixelGrid() {
  const cellRefs = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    const media =
      typeof window !== "undefined"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let frame = 0;
    let start = performance.now();

    const stop = () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      for (const el of cellRefs.current) {
        if (el) {
          el.style.opacity = "0.15";
        }
      }
    };

    const startWave = () => {
      stop();
      start = performance.now();
      const tick = (now: number) => {
        const elapsedMs = now - start;
        const cells = cellRefs.current;
        for (let i = 0; i < DRIVE_PIXEL_DELAYS_MS.length; i += 1) {
          const el = cells[i];
          if (el) {
            el.style.opacity = String(
              drivePixelOpacity(elapsedMs, DRIVE_PIXEL_DELAYS_MS[i]!),
            );
          }
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    const onMotionPreferenceChange = () => {
      if (media?.matches) {
        stop();
      } else {
        startWave();
      }
    };

    onMotionPreferenceChange();
    media?.addEventListener("change", onMotionPreferenceChange);
    return () => {
      media?.removeEventListener("change", onMotionPreferenceChange);
      stop();
    };
  }, []);

  return (
    <span aria-hidden className="bui-pixel-grid" data-testid="bui-drive-grid">
      {DRIVE_PIXEL_DELAYS_MS.map((delayMs, i) => (
        <span
          key={i}
          ref={(el) => {
            cellRefs.current[i] = el;
          }}
          className="bui-pixel-cell"
          style={{ opacity: drivePixelOpacity(0, delayMs) }}
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
        aria-hidden
        className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums"
        data-testid="live-stream-elapsed"
      >
        {formatBeautifulElapsed(elapsedMs)}
      </span>
    </div>
  );
}

interface CoworkerMentionFailedStatusProps {
  label: string;
  className?: string;
}

/**
 * Failed mention terminal status after the live thinking row.
 * Soft alert chip (icon + label) — success is the coworker reply itself (no chrome).
 */
export function CoworkerMentionTerminalStatus({
  label,
  className,
}: CoworkerMentionFailedStatusProps) {
  return (
    <div
      className={cn(
        "border-destructive/20 bg-destructive/10 text-destructive",
        "inline-flex w-fit max-w-full items-center gap-1.5 rounded-md border px-2 py-1",
        className,
      )}
      role="status"
      data-testid="coworker-mention-terminal"
    >
      <CircleAlert
        className="size-3.5 shrink-0"
        aria-hidden
        data-testid="coworker-mention-failed-icon"
      />
      <span className="truncate text-xs font-medium">{label}</span>
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
        aria-hidden
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
