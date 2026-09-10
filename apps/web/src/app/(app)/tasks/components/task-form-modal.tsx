"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ENTER_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(12px)" },
  { opacity: 1, transform: "translateY(0)" },
];
const EXIT_KEYFRAMES: Keyframe[] = [
  { opacity: 1, transform: "translateY(0)" },
  { opacity: 0, transform: "translateY(-12px)" },
];
const ENTER_OPTIONS: KeyframeAnimationOptions = {
  duration: 210,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
  fill: "both",
};
const EXIT_OPTIONS: KeyframeAnimationOptions = {
  duration: 150,
  easing: "ease-out",
  fill: "both",
};

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function animateShell(
  el: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) {
  return el.animate(keyframes, options);
}

function useCreateTaskModalA11y({
  enabled,
  onDismiss,
}: {
  enabled: boolean;
  onDismiss: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    containerRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = [
        ...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ].filter((node) => node.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [enabled, onDismiss]);

  return containerRef;
}

const TaskFormModalHeaderContext = createContext<{
  setHeaderStart: (content: React.ReactNode) => void;
} | null>(null);

export function TaskFormModalHeaderStart({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = useContext(TaskFormModalHeaderContext);
  const childrenRef = useRef(children);
  childrenRef.current = children;

  useLayoutEffect(() => {
    if (!context) return;
    context.setHeaderStart(childrenRef.current);
    return () => context.setHeaderStart(null);
  }, [context]);

  return null;
}

interface TaskFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  cancelLabel: string;
  children: React.ReactNode;
  isDismissDisabled?: boolean;
  /** Animated portal (WAAPI). Create-task only. Other callers stay on Dialog. */
  viewTransition?: boolean;
}

export function TaskFormModal({
  open,
  onOpenChange,
  title,
  cancelLabel,
  children,
  isDismissDisabled = false,
  viewTransition = false,
}: TaskFormModalProps) {
  const titleId = useId();
  const shellRef = useRef<HTMLDivElement>(null);
  const exitingRef = useRef(false);
  const [headerStart, setHeaderStart] = useState<React.ReactNode>(null);
  const registerHeaderStart = useCallback((content: React.ReactNode) => {
    setHeaderStart(content);
  }, []);
  const headerContextValue = useMemo(
    () => ({ setHeaderStart: registerHeaderStart }),
    [registerHeaderStart],
  );

  useEffect(() => {
    if (!open) setHeaderStart(null);
  }, [open]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isDismissDisabled) return;
      onOpenChange(nextOpen);
    },
    [isDismissDisabled, onOpenChange],
  );

  const handleDismiss = useCallback(() => {
    if (isDismissDisabled || exitingRef.current) return;
    const shell = shellRef.current;
    if (!shell || prefersReducedMotion()) {
      handleOpenChange(false);
      return;
    }
    exitingRef.current = true;
    shell.style.pointerEvents = "none";
    const animation = animateShell(shell, EXIT_KEYFRAMES, EXIT_OPTIONS);
    const finish = () => {
      exitingRef.current = false;
      handleOpenChange(false);
    };
    animation.finished.then(finish).catch(finish);
  }, [handleOpenChange, isDismissDisabled]);

  const dialogRef = useCreateTaskModalA11y({
    enabled: viewTransition && open,
    onDismiss: handleDismiss,
  });

  useLayoutEffect(() => {
    if (!viewTransition || !open) return;
    const shell = shellRef.current;
    if (!shell || prefersReducedMotion()) return;
    const animation = animateShell(shell, ENTER_KEYFRAMES, ENTER_OPTIONS);
    return () => {
      animation.cancel();
    };
  }, [open, viewTransition]);

  const panel = (
    <div className="bg-background flex h-svh w-svw flex-col overflow-hidden rounded-none md:h-[min(760px,90svh)] md:w-auto md:rounded-xl md:border md:border-border md:shadow-2xl">
      {viewTransition ? null : (
        <>
          <DialogTitle className="hidden" />
          <DialogDescription className="hidden" />
        </>
      )}
      <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center px-6 py-3 md:px-8">
        <div className="justify-self-start">{headerStart}</div>
        <h3 id={titleId} className="text-base font-semibold">
          {title}
        </h3>
        <div className="justify-self-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            disabled={isDismissDisabled}
          >
            <span className="text-primary text-sm">{cancelLabel}</span>
          </Button>
        </div>
      </div>
      <div className="shrink-0 border-t" />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );

  if (viewTransition) {
    return (
      <TaskFormModalHeaderContext value={headerContextValue}>
        {open && typeof document !== "undefined"
          ? createPortal(
              <div
                ref={shellRef}
                data-testid="create-task-modal-vt"
                className="fixed inset-0 z-50"
              >
                <div
                  data-testid="create-task-modal-overlay"
                  className="absolute inset-0 bg-background/50 backdrop-blur-lg"
                  onClick={handleDismiss}
                />
                <div
                  ref={dialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={titleId}
                  tabIndex={-1}
                  className="absolute top-1/2 left-1/2 w-svw max-w-6xl -translate-x-1/2 -translate-y-1/2 outline-none md:w-[92vw]"
                >
                  {panel}
                </div>
              </div>,
              document.body,
            )
          : null}
      </TaskFormModalHeaderContext>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-svw max-w-6xl! border-none bg-transparent p-0 shadow-none focus:ring-0 focus:outline-none md:w-[92vw] [&>button]:hidden">
        <TaskFormModalHeaderContext value={headerContextValue}>
          {panel}
        </TaskFormModalHeaderContext>
      </DialogContent>
    </Dialog>
  );
}
