"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

interface TasksEmptyStateOverlayLabels {
  title: string;
  description: string;
  getStartedTitle: string;
  getStartedDescription: string;
  getStartedButton: string;
  next: string;
  back: string;
  addTaskHint: string;
  elenaAvatarAlt: string;
}

interface TasksEmptyStateOverlayProps {
  labels: TasksEmptyStateOverlayLabels;
  onComplete: () => void;
  onDismiss: () => void;
}

interface Point {
  x: number;
  y: number;
}

interface ConnectorLayout {
  start: Point;
  end: Point;
  label: Point;
}

const ADD_FALLBACK_LEFT_PADDING = 56;
const ADD_FALLBACK_BOTTOM_PADDING = 210;
const ADD_TARGET_OUTSIDE_OFFSET = 14;
const ADD_LINE_ENDPOINT_OFFSET = 0;
const MOBILE_HINT_ESTIMATED_WIDTH = 140;
const MOBILE_HINT_VIEWPORT_PADDING = 12;

type TasksEmptyStateTargetSurface = "desktop" | "mobile";

function hasLayoutBox(element: HTMLElement | null): element is HTMLElement {
  if (!element) return false;
  const { width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0;
}

function selectListMobileCreateFabTarget(): HTMLElement | null {
  const shell = document.querySelector<HTMLElement>(
    "[data-list-mobile-create-fab]",
  );
  if (!shell) return null;
  return shell.querySelector("button") ?? shell;
}

/**
 * Prefer a visible column add control, then (on mobile) the list create FAB,
 * then the header add button. Skip zero-size nodes (e.g. `hidden md:inline-flex`
 * header control still in the DOM below `md`).
 */
export function selectTasksEmptyStateAddTaskTarget(
  surface: TasksEmptyStateTargetSurface = "desktop",
): HTMLElement | null {
  const column = document.querySelector<HTMLElement>(
    "[data-tasks-add-task-column-anchor]",
  );
  if (hasLayoutBox(column)) return column;

  if (surface === "mobile") {
    const fab = selectListMobileCreateFabTarget();
    if (hasLayoutBox(fab)) return fab;
  }

  const header = document.querySelector<HTMLElement>(
    "[data-tasks-add-task-header-anchor]",
  );
  if (hasLayoutBox(header)) return header;

  return null;
}

/**
 * Keep the mobile “add task” hint on-screen. Right-aligned FAB leaves ~24px
 * when the label is placed at `end.x + 20`; prefer left-of-target + clamp.
 */
export function resolveMobileGuideHintPosition(
  end: Point,
  start: Point,
  viewportWidth: number,
): Point {
  const maxX = Math.max(
    MOBILE_HINT_VIEWPORT_PADDING,
    viewportWidth - MOBILE_HINT_ESTIMATED_WIDTH - MOBILE_HINT_VIEWPORT_PADDING,
  );
  const isTargetAbove = end.y < start.y;

  if (isTargetAbove) {
    return {
      x: Math.min(end.x + 20, maxX),
      y: end.y + 60,
    };
  }

  return {
    x: Math.min(
      Math.max(
        MOBILE_HINT_VIEWPORT_PADDING,
        end.x - MOBILE_HINT_ESTIMATED_WIDTH,
      ),
      maxX,
    ),
    y: end.y - 48,
  };
}

const GUIDE_STEPS = ["addTask", "getStarted"] as const;

type TasksEmptyStateGuideStep = (typeof GUIDE_STEPS)[number];

interface TasksEmptyStateGuideContent {
  title: string;
  description: string;
  hint: string;
}

export function getTasksEmptyStateGuideContent(
  step: TasksEmptyStateGuideStep,
  labels: TasksEmptyStateOverlayLabels,
): TasksEmptyStateGuideContent {
  switch (step) {
    case "addTask":
      return {
        title: labels.title,
        description: labels.description,
        hint: labels.addTaskHint,
      };
    case "getStarted":
      return {
        title: labels.getStartedTitle,
        description: labels.getStartedDescription,
        hint: "",
      };
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

export function TasksEmptyStateOverlay({
  labels,
  onComplete,
  onDismiss,
}: TasksEmptyStateOverlayProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const mobileCardRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<ConnectorLayout | null>(null);
  const [mobileLayout, setMobileLayout] = useState<ConnectorLayout | null>(
    null,
  );
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let animationFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      scheduleLayoutRecalculation();
    });

    function recalculateDesktopLayout() {
      const cardElement = cardRef.current;
      if (!cardElement) return;

      const cardRect = cardElement.getBoundingClientRect();
      const addTaskRect =
        selectTasksEmptyStateAddTaskTarget(
          "desktop",
        )?.getBoundingClientRect() ?? null;

      const end: Point = addTaskRect
        ? {
            x:
              addTaskRect.right +
              ADD_TARGET_OUTSIDE_OFFSET +
              ADD_LINE_ENDPOINT_OFFSET,
            y: addTaskRect.top + addTaskRect.height * 0.52,
          }
        : {
            x: ADD_FALLBACK_LEFT_PADDING,
            y: Math.max(
              cardRect.bottom + 16,
              window.innerHeight - ADD_FALLBACK_BOTTOM_PADDING,
            ),
          };

      setLayout({
        start: {
          x: cardRect.left + 24,
          y: cardRect.bottom - 24,
        },
        end,
        label: {
          x: end.x + 40,
          y: end.y,
        },
      });
    }

    function recalculateMobileLayout() {
      const cardElement = mobileCardRef.current;
      if (!cardElement) return;

      const cardRect = cardElement.getBoundingClientRect();
      const addTaskRect =
        selectTasksEmptyStateAddTaskTarget("mobile")?.getBoundingClientRect() ??
        null;

      const start: Point = {
        x: cardRect.left + cardRect.width / 2,
        y: cardRect.top,
      };

      const end: Point = addTaskRect
        ? {
            x: addTaskRect.left + addTaskRect.width / 2,
            // Point at the near edge: above-card targets use bottom; FAB below uses top.
            y:
              addTaskRect.top + addTaskRect.height / 2 < cardRect.top
                ? addTaskRect.bottom
                : addTaskRect.top,
          }
        : {
            x: ADD_FALLBACK_LEFT_PADDING,
            y: Math.max(
              cardRect.bottom + 16,
              window.innerHeight - ADD_FALLBACK_BOTTOM_PADDING,
            ),
          };

      setMobileLayout({
        start,
        end,
        label: resolveMobileGuideHintPosition(end, start, window.innerWidth),
      });
    }

    function recalculateLayouts() {
      recalculateDesktopLayout();
      recalculateMobileLayout();
    }

    function scheduleLayoutRecalculation() {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(recalculateLayouts);
    }

    scheduleLayoutRecalculation();
    window.addEventListener("resize", scheduleLayoutRecalculation);
    window.addEventListener("scroll", scheduleLayoutRecalculation, true);

    const desktopCard = cardRef.current;
    if (desktopCard) resizeObserver.observe(desktopCard);
    const mobileCard = mobileCardRef.current;
    if (mobileCard) resizeObserver.observe(mobileCard);
    resizeObserver.observe(document.body);

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", scheduleLayoutRecalculation);
      window.removeEventListener("scroll", scheduleLayoutRecalculation, true);
      resizeObserver.disconnect();
    };
  }, [stepIndex]);

  const connectorPath = useMemo(() => {
    if (!layout) return null;
    return buildConnectorPath(layout.start, layout.end);
  }, [layout]);
  const currentStep = GUIDE_STEPS[stepIndex];
  const currentContent = useMemo(
    () => getTasksEmptyStateGuideContent(currentStep, labels),
    [currentStep, labels],
  );
  const canMoveNext = stepIndex < GUIDE_STEPS.length - 1;
  const canMoveBack = stepIndex > 0;
  const isGetStartedStep = currentStep === "getStarted";

  const handleMoveNext = () => {
    if (!canMoveNext) return;
    setStepIndex((prevStepIndex) => prevStepIndex + 1);
  };

  const handleMoveBack = () => {
    if (!canMoveBack) return;
    setStepIndex((prevStepIndex) => prevStepIndex - 1);
  };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onDismiss();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onDismiss]);

  const mobileContent = useMemo(
    () =>
      getTasksEmptyStateGuideContent(
        isGetStartedStep ? "getStarted" : "addTask",
        labels,
      ),
    [isGetStartedStep, labels],
  );
  const mobileConnectorPath = useMemo(() => {
    if (!mobileLayout) return null;
    return buildMobileConnectorPath(mobileLayout.start, mobileLayout.end);
  }, [mobileLayout]);

  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 z-50 hidden md:block"
        aria-hidden
        data-tasks-empty-state-overlay
      >
        {connectorPath && layout && !isGetStartedStep ? (
          <svg className="absolute inset-0 h-full w-full">
            <defs>
              <marker
                id="tasks-overlay-arrowhead"
                markerUnits="userSpaceOnUse"
                viewBox="0 0 16 16"
                markerWidth="8"
                markerHeight="8"
                refX="4"
                refY="8"
                orient="auto"
              >
                <path d="M 0 0 L 16 8 L 0 16 z" className="fill-primary/85" />
              </marker>
            </defs>
            <path
              key={currentStep}
              d={connectorPath}
              className="stroke-primary/70 motion-safe:animate-in motion-safe:fade-in fill-none transition-opacity duration-200"
              strokeWidth={1.5}
              strokeLinecap="round"
              markerEnd="url(#tasks-overlay-arrowhead)"
            />
          </svg>
        ) : null}

        {layout && !isGetStartedStep ? (
          <div
            key={`${currentStep}-hint`}
            className="text-primary bg-background border-primary/30 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 absolute rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium shadow-sm transition-opacity duration-200"
            style={{
              left: layout.label.x,
              top: layout.label.y,
            }}
          >
            {currentContent.hint}
          </div>
        ) : null}

        <div className="absolute top-1/2 left-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 px-4">
          <div
            ref={cardRef}
            className="bg-muted border-border motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 pointer-events-auto rounded-xl border p-5 shadow-lg"
          >
            <div className="flex items-start gap-3">
              <div className="relative size-20 shrink-0 overflow-hidden rounded-md border">
                <Image
                  src="/images/coworkers/elena.webp"
                  alt={labels.elenaAvatarAlt}
                  fill
                  className="object-cover object-top"
                  sizes="80px"
                />
              </div>
              <div
                key={currentStep}
                className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 space-y-1.5"
              >
                <h2 className="text-base font-semibold tracking-tight">
                  {currentContent.title}
                </h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {currentContent.description}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t pt-3">
              {canMoveBack ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="pointer-events-auto"
                  onClick={handleMoveBack}
                >
                  {labels.back}
                </Button>
              ) : (
                <div />
              )}
              {isGetStartedStep ? (
                <Button
                  type="button"
                  size="sm"
                  className="pointer-events-auto"
                  onClick={onComplete}
                >
                  {labels.getStartedButton}
                </Button>
              ) : canMoveNext ? (
                <Button
                  type="button"
                  size="sm"
                  className="pointer-events-auto"
                  onClick={handleMoveNext}
                >
                  {labels.next}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div
        className="pointer-events-none fixed inset-0 z-50 md:hidden"
        aria-hidden
        data-tasks-empty-state-overlay-mobile
      >
        {mobileLayout && !isGetStartedStep ? (
          <svg className="absolute inset-0 h-full w-full">
            <defs>
              <marker
                id="tasks-overlay-arrowhead-mobile"
                markerUnits="userSpaceOnUse"
                viewBox="0 0 16 16"
                markerWidth="8"
                markerHeight="8"
                refX="4"
                refY="8"
                orient="auto"
              >
                <path d="M 0 0 L 16 8 L 0 16 z" className="fill-primary/85" />
              </marker>
            </defs>
            {mobileConnectorPath ? (
              <path
                d={mobileConnectorPath}
                className="stroke-primary/70 fill-none"
                strokeWidth={1.5}
                strokeLinecap="round"
                markerEnd="url(#tasks-overlay-arrowhead-mobile)"
              />
            ) : null}
          </svg>
        ) : null}

        {mobileLayout && !isGetStartedStep ? (
          <div
            className="text-primary bg-background border-primary/30 absolute rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium shadow-sm"
            style={{
              left: mobileLayout.label.x,
              top: mobileLayout.label.y,
            }}
          >
            {mobileContent.hint}
          </div>
        ) : null}

        <div className="absolute top-1/2 left-1/2 w-full max-w-88 -translate-x-1/2 -translate-y-1/2 px-3">
          <div
            ref={mobileCardRef}
            className="bg-muted border-border pointer-events-auto rounded-xl border p-4 shadow-md"
          >
            <div className="flex items-start gap-3">
              <div className="relative size-12 shrink-0 overflow-hidden rounded-md border">
                <Image
                  src="/images/coworkers/elena.webp"
                  alt={labels.elenaAvatarAlt}
                  fill
                  className="object-cover object-top"
                  sizes="48px"
                />
              </div>
              <div
                key={isGetStartedStep ? "getStarted" : "addTask"}
                className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 space-y-1.5"
              >
                <h2 className="text-sm font-semibold tracking-tight">
                  {mobileContent.title}
                </h2>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {mobileContent.description}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t pt-3">
              {isGetStartedStep ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="pointer-events-auto"
                    onClick={handleMoveBack}
                  >
                    {labels.back}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="pointer-events-auto"
                    onClick={onComplete}
                  >
                    {labels.getStartedButton}
                  </Button>
                </>
              ) : (
                <>
                  <div />
                  <Button
                    type="button"
                    size="sm"
                    className="pointer-events-auto"
                    onClick={handleMoveNext}
                  >
                    {labels.next}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function buildConnectorPath(start: Point, end: Point) {
  const horizontalDelta = Math.max(Math.abs(start.x - end.x) * 0.33, 96);
  const verticalDelta = Math.max(Math.abs(start.y - end.y) * 0.2, 28);
  const endApproachOffset = Math.max(Math.abs(start.x - end.x) * 0.12, 30);

  const c1: Point = {
    x: start.x - horizontalDelta,
    y: start.y + verticalDelta,
  };
  const c2: Point = {
    x: end.x + endApproachOffset,
    y: end.y,
  };

  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}

function buildMobileConnectorPath(start: Point, end: Point) {
  const isTargetAbove = end.y < start.y;
  const verticalDistance = Math.max(Math.abs(start.y - end.y), 0);

  if (isTargetAbove) {
    const c1: Point = {
      x: start.x - Math.max(Math.abs(start.x - end.x) * 0.22, 26),
      y: start.y - Math.max(verticalDistance * 0.35, 42),
    };
    const c2: Point = {
      x: end.x,
      y: end.y + Math.max(verticalDistance * 0.3, 32),
    };
    return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
  }

  const c1: Point = {
    x: start.x + Math.max(Math.abs(start.x - end.x) * 0.22, 26),
    y: start.y + Math.max(verticalDistance * 0.35, 42),
  };
  const c2: Point = {
    x: end.x,
    y: end.y - Math.max(verticalDistance * 0.3, 32),
  };
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}
