"use client";

import {
  Activity,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  ViewTransition,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/** Fallback only when View Transitions are unsupported. Matches exit CSS (~150ms). */
const CREATE_TASK_MODAL_EXIT_MS = 200;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isViewTransitionUnsupported() {
  return (
    typeof document === "undefined" || !("startViewTransition" in document)
  );
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
  /** Create-task modal only. Other TaskFormModal callers stay unanimated. */
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
  const [headerStart, setHeaderStart] = useState<React.ReactNode>(null);
  const registerHeaderStart = useCallback((content: React.ReactNode) => {
    setHeaderStart(content);
  }, []);
  const headerContextValue = useMemo(
    () => ({ setHeaderStart: registerHeaderStart }),
    [registerHeaderStart],
  );

  const [portalOpen, setPortalOpen] = useState(open);
  if (open && !portalOpen) {
    setPortalOpen(true);
  }

  useEffect(() => {
    if (!open) setHeaderStart(null);
  }, [open]);

  const closePortal = useCallback(() => {
    setPortalOpen(false);
  }, []);

  useEffect(() => {
    if (!viewTransition || open || !portalOpen) return;
    if (!isViewTransitionUnsupported()) return;
    const timeoutId = window.setTimeout(closePortal, CREATE_TASK_MODAL_EXIT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [viewTransition, open, portalOpen, closePortal]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isDismissDisabled) return;
      onOpenChange(nextOpen);
    },
    [isDismissDisabled, onOpenChange],
  );

  const handleDismiss = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const dialogOpen = viewTransition ? open || portalOpen : open;
  const dialogRef = useCreateTaskModalA11y({
    enabled: viewTransition && dialogOpen,
    onDismiss: handleDismiss,
  });

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
        {dialogOpen && typeof document !== "undefined"
          ? createPortal(
              <Activity mode={open ? "visible" : "hidden"}>
                <ViewTransition
                  default="none"
                  enter="create-task-modal-enter"
                  exit="create-task-modal-exit"
                  onExit={() => () => closePortal()}
                >
                  <div
                    data-create-task-modal-vt=""
                    data-testid="create-task-modal-vt"
                    className="fixed inset-0 z-50"
                  >
                    <div
                      data-testid="create-task-modal-overlay"
                      className="absolute inset-0 bg-background/50 backdrop-blur-lg md:bg-auto"
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
                  </div>
                </ViewTransition>
              </Activity>,
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
