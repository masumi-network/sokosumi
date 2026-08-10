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

const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

function useLiveElapsedMs(startedAtMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, now - startedAtMs);
}

/**
 * Pixel-grid loader + shimmer label + live elapsed (Beautiful UI Loading State).
 * Used while the coworker stream has no answer yet.
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
      <span
        aria-hidden
        className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]"
      >
        {CHEVRON_DELAYS.map((delay, i) => (
          <span
            key={i}
            className="bg-foreground size-1 rounded-[1px] motion-reduce:animate-none"
            style={{
              opacity: 0.15,
              animation: `bui-pixel-on 650ms ease-in-out ${delay}ms infinite`,
            }}
          />
        ))}
      </span>
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
                  className="text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap"
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
