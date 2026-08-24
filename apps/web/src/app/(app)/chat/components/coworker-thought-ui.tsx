"use client";

/**
 * Loading + Thinking primitives adapted from Beautiful UI
 * (https://beautiful-ui-five.vercel.app/ — Loading State / Thinking · Reasoning).
 * Tokens remapped to Sokosumi semantic colors.
 */

import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

/** Live timer: tenths under 10s, then whole seconds (`10s`, `1m 15s`). */
export function formatBeautifulElapsed(elapsedMs: number): string {
  const total = Math.max(0, elapsedMs) / 1000;
  if (total < 10) {
    return `${total.toFixed(1)}s`;
  }
  const secs = Math.floor(total);
  if (secs < 60) {
    return `${secs}s`;
  }
  const minutes = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
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

function ThoughtSparkle({ working }: { working: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-3 shrink-0"
      fill={
        working
          ? "var(--muted-foreground)"
          : "color-mix(in oklab, var(--muted-foreground) 70%, transparent)"
      }
    >
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
    </svg>
  );
}

/** Settled sparkle on a failed mention shell so Thinking → fail does not swap widgets. */
export function CoworkerFailedThoughtSparkle({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "-mx-1 flex min-h-6 w-fit max-w-full items-center rounded-md px-1 py-0.5",
        className,
      )}
      data-testid="coworker-thought-sparkle"
    >
      <ThoughtSparkle working={false} />
    </div>
  );
}

/**
 * Expandable Thought header + optional prose body (Beautiful UI Thinking · Reasoning).
 * - Live: working shimmer "Thinking" + optional live beat in expanded body
 * - Done: "Thought for Ns" settled label + full Thought text
 */
function thoughtBeatSteps(bodyText: string): string[] {
  return bodyText
    .split(/\n\n+/)
    .map((step) => step.trim())
    .filter((step) => step.length > 0);
}

export function CoworkerThoughtTrace({
  working,
  headerLabel,
  bodyText,
  elapsed = null,
  defaultExpanded = false,
  className,
}: {
  working: boolean;
  headerLabel: string;
  bodyText?: string | null;
  elapsed?: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const traceRef = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(0);
  const hasBody = Boolean(bodyText?.trim());
  const beatSteps = hasBody ? thoughtBeatSteps(bodyText ?? "") : [];

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
          // min-h-6 keeps ~24px touch target at default root while type stays text-xs.
          "-mx-1 flex min-h-6 w-fit max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left",
          "transition-colors duration-100",
          hasBody &&
            "hover:bg-muted/60 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          !hasBody && "cursor-default",
        )}
      >
        <ThoughtSparkle working={working} />
        {working ? (
          <span className="bui-shimmer-text truncate text-xs font-medium whitespace-nowrap">
            {headerLabel}
          </span>
        ) : (
          <span className="text-muted-foreground truncate text-xs font-medium whitespace-nowrap">
            {headerLabel}
          </span>
        )}
        {elapsed}
        {hasBody ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="text-muted-foreground size-3 shrink-0 transition-transform duration-300"
            style={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
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
            <div className="relative mt-0.5 ml-1 pl-3">
              <span
                aria-hidden
                className="bg-border absolute -top-1 left-px w-px"
                style={{
                  // Dynamic body height from layout; 2px short so rail ends in the text block.
                  height: lineHeight ? Math.max(0, lineHeight - 2) : 0,
                  transition: "height 500ms cubic-bezier(0.23,1,0.32,1)",
                }}
              />
              <div
                ref={traceRef}
                className={cn(
                  "flex flex-col gap-1 py-0",
                  // Spec: clamp live beat so multi-reader rooms do not flood.
                  working && "line-clamp-3",
                )}
                data-testid="coworker-thought-body"
              >
                {beatSteps.map((step, index) => (
                  <p
                    key={`${index}:${step.slice(0, 24)}`}
                    className="text-muted-foreground text-xs leading-snug"
                  >
                    {step}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Live Thought: sparkle header from silent think through beats so the icon
 * does not swap when the first step arrives.
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
  return (
    <div className="min-w-0" role="status" aria-live="polite">
      <CoworkerThoughtTrace
        working
        headerLabel={label}
        bodyText={liveBeat}
        defaultExpanded
        elapsed={
          <span
            aria-hidden
            className="text-muted-foreground font-mono text-xs tabular-nums"
            data-testid="live-stream-elapsed"
          >
            <LiveElapsed startedAtMs={startedAtMs} />
          </span>
        }
      />
    </div>
  );
}

function LiveElapsed({ startedAtMs }: { startedAtMs: number }) {
  const elapsedMs = useLiveElapsedMs(startedAtMs);
  return <>{formatBeautifulElapsed(elapsedMs)}</>;
}
