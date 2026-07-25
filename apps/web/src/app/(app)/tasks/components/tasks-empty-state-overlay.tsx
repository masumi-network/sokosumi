"use client";

import { Loader2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAppChatRail } from "@/contexts/app-chat-rail-context";
import {
  CHAT_RAIL_READY_POLL_MS,
  CHAT_RAIL_READY_TIMEOUT_MS,
} from "@/lib/constants/chat-rail-ready";

interface TasksEmptyStateOverlayLabels {
  title: string;
  description: string;
  chatTitle: string;
  chatDescription: string;
  getStartedTitle: string;
  getStartedDescription: string;
  getStartedButton: string;
  next: string;
  back: string;
  addTaskHint: string;
  chatHint: string;
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
  leftStart: Point;
  leftEnd: Point;
  rightStart: Point;
  rightEnd: Point;
  leftLabel: Point;
  rightLabel: Point;
}

const CHAT_FALLBACK_RIGHT_PADDING = 56;
const CHAT_FALLBACK_BOTTOM_PADDING = 96;
const ADD_FALLBACK_LEFT_PADDING = 56;
const ADD_FALLBACK_BOTTOM_PADDING = 210;
const ADD_TARGET_OUTSIDE_OFFSET = 14;
const ADD_LINE_ENDPOINT_OFFSET = 0;
const CHAT_BORDER_OUTSIDE_OFFSET = 10;

function selectTasksEmptyStateAddTaskTarget(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(
      "[data-tasks-add-task-column-anchor]",
    ) ??
    document.querySelector<HTMLElement>("[data-tasks-add-task-header-anchor]")
  );
}

function selectTasksEmptyStateChatTarget(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>("[data-chat-input-border-anchor]") ??
    document.querySelector<HTMLElement>("[data-chat-rail-anchor]") ??
    document.querySelector<HTMLElement>("[data-chat-rail-trigger-anchor]") ??
    document.querySelector<HTMLElement>("[data-testid='multimodal-input']")
  );
}

function selectTasksEmptyStateChatRailPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-chat-rail-panel]");
}

const GUIDE_STEPS = ["addTask", "chat", "getStarted"] as const;

type TasksEmptyStateGuideStep = (typeof GUIDE_STEPS)[number];

interface TasksEmptyStateGuideContent {
  title: string;
  description: string;
  hint: string;
}

function isTasksEmptyStateChatRailPanelReady(): boolean {
  const railPanelElement = selectTasksEmptyStateChatRailPanel();
  if (!railPanelElement) return true;

  return railPanelElement.dataset.chatRailReady === "true";
}

export function getTasksEmptyStateGuideContent(
  step: TasksEmptyStateGuideStep,
  labels: TasksEmptyStateOverlayLabels,
): TasksEmptyStateGuideContent {
  if (step === "addTask") {
    return {
      title: labels.title,
      description: labels.description,
      hint: labels.addTaskHint,
    };
  }

  if (step === "getStarted") {
    return {
      title: labels.getStartedTitle,
      description: labels.getStartedDescription,
      hint: "",
    };
  }

  return {
    title: labels.chatTitle,
    description: labels.chatDescription,
    hint: labels.chatHint,
  };
}

export function TasksEmptyStateOverlay({
  labels,
  onComplete,
  onDismiss,
}: TasksEmptyStateOverlayProps) {
  const { open, openMobile, openLatestChat } = useAppChatRail();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const mobileCardRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<ConnectorLayout | null>(null);
  const [mobileLayout, setMobileLayout] = useState<{
    start: Point;
    end: Point;
    label: Point;
  } | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [isAdvancingToChatStep, setIsAdvancingToChatStep] = useState(false);
  const [isChatPanelReadyForConnector, setIsChatPanelReadyForConnector] =
    useState(false);
  const isChatRailOpen = open || openMobile;

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
        selectTasksEmptyStateAddTaskTarget()?.getBoundingClientRect() ?? null;
      const chatRect =
        selectTasksEmptyStateChatTarget()?.getBoundingClientRect() ?? null;

      const leftEnd: Point = addTaskRect
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

      const rightEnd: Point = chatRect
        ? {
            x: chatRect.left + chatRect.width * 0.22,
            y: chatRect.top - CHAT_BORDER_OUTSIDE_OFFSET,
          }
        : {
            x: window.innerWidth - CHAT_FALLBACK_RIGHT_PADDING,
            y: window.innerHeight - CHAT_FALLBACK_BOTTOM_PADDING,
          };

      setLayout({
        leftStart: {
          x: cardRect.left + 24,
          y: cardRect.bottom - 24,
        },
        leftEnd,
        rightStart: {
          x: cardRect.right - 24,
          y: cardRect.bottom - 26,
        },
        rightEnd,
        leftLabel: {
          x: leftEnd.x + 40,
          y: leftEnd.y - 0,
        },
        rightLabel: {
          x: rightEnd.x - 80,
          y: rightEnd.y - 88,
        },
      });
    }

    function recalculateMobileLayout() {
      const cardElement = mobileCardRef.current;
      if (!cardElement) return;

      const cardRect = cardElement.getBoundingClientRect();
      const addTaskRect =
        selectTasksEmptyStateAddTaskTarget()?.getBoundingClientRect() ?? null;

      const end: Point = addTaskRect
        ? {
            x: addTaskRect.left + addTaskRect.width / 2,
            y: addTaskRect.bottom,
          }
        : {
            x: ADD_FALLBACK_LEFT_PADDING,
            y: Math.max(
              cardRect.bottom + 16,
              window.innerHeight - ADD_FALLBACK_BOTTOM_PADDING,
            ),
          };

      setMobileLayout({
        start: {
          x: cardRect.left + cardRect.width / 2,
          y: cardRect.top,
        },
        end,
        label: {
          x: end.x + 20,
          y: end.y + 60,
        },
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
  }, [open, openMobile, stepIndex]);

  const connectorPaths = useMemo(() => {
    if (!layout) return null;

    return {
      left: buildConnectorPath(layout.leftStart, layout.leftEnd, "left"),
      right: buildConnectorPath(layout.rightStart, layout.rightEnd, "right"),
    };
  }, [layout]);
  const currentStep = GUIDE_STEPS[stepIndex];
  const currentContent = useMemo(
    () => getTasksEmptyStateGuideContent(currentStep, labels),
    [currentStep, labels],
  );
  const canMoveNext = stepIndex < GUIDE_STEPS.length - 1;
  const canMoveBack = stepIndex > 0;

  const handleMoveNext = () => {
    if (!canMoveNext || isAdvancingToChatStep) return;

    const nextStep = GUIDE_STEPS[stepIndex + 1];
    if (nextStep === "chat") {
      if (!isChatRailOpen) {
        openLatestChat();
        setIsAdvancingToChatStep(true);
        return;
      }
      if (isTasksEmptyStateChatRailPanelReady()) {
        // Same turn as step → chat so `shouldRenderChatConnector` is true on first
        // paint (avoids rAF-deferred readiness vs sync step advance flicker).
        setIsChatPanelReadyForConnector(true);
        setStepIndex((prevStepIndex) => prevStepIndex + 1);
        return;
      }
      setIsAdvancingToChatStep(true);
      return;
    }

    setStepIndex((prevStepIndex) => prevStepIndex + 1);
  };

  const handleMoveBack = () => {
    if (!canMoveBack) return;
    setStepIndex((prevStepIndex) => prevStepIndex - 1);
  };

  useEffect(() => {
    if (stepIndex !== 1 && !isAdvancingToChatStep) return;
    if (isChatRailOpen) return;

    const animationFrame = window.requestAnimationFrame(() => {
      setStepIndex(0);
      setIsAdvancingToChatStep(false);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isAdvancingToChatStep, isChatRailOpen, stepIndex]);

  /**
   * Polls desktop `data-chat-rail-ready` and advances the guide when pending.
   * Readiness + step advance run in one synchronous callback (poll / fallback /
   * effect body) so we never paint chat step with connector still hidden—unlike
   * splitting `setIsChatPanelReadyForConnector` (rAF) from `setStepIndex` (timer).
   */
  useEffect(() => {
    let pollTimeoutId = 0;
    let fallbackTimeoutId = 0;

    function clearFallbackTimeout() {
      if (fallbackTimeoutId) {
        window.clearTimeout(fallbackTimeoutId);
        fallbackTimeoutId = 0;
      }
    }

    function applyReadinessOrAdvance(ready: boolean) {
      const pendingAdvanceToChat =
        isAdvancingToChatStep && GUIDE_STEPS[stepIndex + 1] === "chat";
      if (ready && pendingAdvanceToChat) {
        setIsChatPanelReadyForConnector(true);
        setStepIndex((prevStepIndex) => prevStepIndex + 1);
        setIsAdvancingToChatStep(false);
        return;
      }
      setIsChatPanelReadyForConnector(ready);
    }

    function cleanup() {
      if (pollTimeoutId) window.clearTimeout(pollTimeoutId);
      clearFallbackTimeout();
    }

    if (!isChatRailOpen) {
      applyReadinessOrAdvance(false);
      return cleanup;
    }

    // Desktop `data-chat-rail-ready` is only driven when `open` (rail visible).
    // Mobile sheet uses `openMobile` only — panel stays not-ready forever; treat as ready.
    if (!open) {
      applyReadinessOrAdvance(true);
      return cleanup;
    }

    if (!selectTasksEmptyStateChatRailPanel()) {
      applyReadinessOrAdvance(true);
      return cleanup;
    }

    const syncFromDom = () => {
      const ready = isTasksEmptyStateChatRailPanelReady();
      if (ready) clearFallbackTimeout();
      applyReadinessOrAdvance(ready);
      if (!ready) {
        pollTimeoutId = window.setTimeout(syncFromDom, CHAT_RAIL_READY_POLL_MS);
      }
    };

    fallbackTimeoutId = window.setTimeout(() => {
      fallbackTimeoutId = 0;
      if (pollTimeoutId) {
        window.clearTimeout(pollTimeoutId);
        pollTimeoutId = 0;
      }
      applyReadinessOrAdvance(true);
    }, CHAT_RAIL_READY_TIMEOUT_MS);

    syncFromDom();

    return cleanup;
  }, [isAdvancingToChatStep, isChatRailOpen, open, stepIndex]);

  const shouldRenderChatConnector =
    currentStep !== "chat" || isChatPanelReadyForConnector;
  const activeConnectorPath =
    currentStep === "getStarted"
      ? null
      : currentStep === "addTask"
        ? connectorPaths?.left
        : shouldRenderChatConnector
          ? connectorPaths?.right
          : null;
  const activeLabelPosition =
    currentStep === "getStarted"
      ? null
      : currentStep === "addTask"
        ? layout?.leftLabel
        : shouldRenderChatConnector
          ? layout?.rightLabel
          : null;
  const isGetStartedStep = currentStep === "getStarted";

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
        {connectorPaths && layout ? (
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
            {activeConnectorPath ? (
              <path
                key={currentStep}
                d={activeConnectorPath}
                className="stroke-primary/70 motion-safe:animate-in motion-safe:fade-in fill-none transition-opacity duration-200"
                strokeWidth={1.5}
                strokeLinecap="round"
                markerEnd="url(#tasks-overlay-arrowhead)"
              />
            ) : null}
          </svg>
        ) : null}

        {activeLabelPosition ? (
          <div
            key={`${currentStep}-hint`}
            className="text-primary bg-background border-primary/30 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 absolute rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm transition-opacity duration-200"
            style={{
              left: activeLabelPosition.x,
              top: activeLabelPosition.y,
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
                  disabled={isAdvancingToChatStep}
                  onClick={handleMoveNext}
                >
                  {isAdvancingToChatStep ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : null}
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
            className="text-primary bg-background border-primary/30 absolute rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm"
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
            {isGetStartedStep ? (
              <div className="mt-3 flex items-center justify-between border-t pt-3">
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
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

function buildConnectorPath(
  start: Point,
  end: Point,
  direction: "left" | "right",
) {
  if (direction === "left") {
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

  const horizontalDelta = Math.max(Math.abs(start.x - end.x) * 0.45, 120);
  const verticalDelta = Math.max(Math.abs(start.y - end.y) * 0.28, 40);
  const c1: Point = {
    x: start.x + horizontalDelta,
    y: start.y + verticalDelta,
  };
  const c2: Point = {
    x: end.x - horizontalDelta * 0.35,
    y: end.y - verticalDelta,
  };

  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}

function buildMobileConnectorPath(start: Point, end: Point) {
  const verticalDistance = Math.max(start.y - end.y, 0);
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
