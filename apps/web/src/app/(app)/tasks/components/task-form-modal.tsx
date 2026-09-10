"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  ViewTransition,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Matches `::view-transition-old(.create-task-modal-exit)` in globals.css. */
const CREATE_TASK_MODAL_EXIT_MS = 150;

const VIEW_TRANSITION_CONTENT_CLASS =
  "duration-0 data-[state=closed]:animate-none data-[state=open]:animate-none";

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
  const [headerStart, setHeaderStart] = useState<React.ReactNode>(null);
  const registerHeaderStart = useCallback((content: React.ReactNode) => {
    setHeaderStart(content);
  }, []);
  const headerContextValue = useMemo(
    () => ({ setHeaderStart: registerHeaderStart }),
    [registerHeaderStart],
  );

  const [portalOpen, setPortalOpen] = useState(open);

  useLayoutEffect(() => {
    if (open) setPortalOpen(true);
  }, [open]);

  useEffect(() => {
    if (!open) setHeaderStart(null);
  }, [open]);

  const closePortal = useCallback(() => {
    setPortalOpen(false);
  }, []);

  // React 19.3: onExit/onUpdate cleanup runs when the View Transition finishes.
  // Timeout covers browsers/tests that skip View Transitions.
  const handleViewTransitionSettled = useCallback(
    () => closePortal,
    [closePortal],
  );

  useEffect(() => {
    if (!viewTransition || open || !portalOpen) return;
    const timeoutId = window.setTimeout(closePortal, CREATE_TASK_MODAL_EXIT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [viewTransition, open, portalOpen, closePortal]);

  // Clicking outside / pressing Escape closes the modal, except while a submit
  // or upload is in flight (guarded by isDismissDisabled).
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isDismissDisabled) return;
    if (viewTransition) {
      startTransition(() => {
        onOpenChange(nextOpen);
      });
      return;
    }
    onOpenChange(nextOpen);
  };

  const panel = (
    <div className="bg-background flex h-svh w-svw flex-col overflow-hidden rounded-none md:h-[min(760px,90svh)] md:w-auto md:rounded-xl md:border md:border-border md:shadow-2xl">
      <DialogTitle className="hidden" />
      <DialogDescription className="hidden" />
      <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center px-6 py-3 md:px-8">
        <div className="justify-self-start">{headerStart}</div>
        <h3 className="text-base font-semibold">{title}</h3>
        <div className="justify-self-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
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

  return (
    <Dialog
      open={viewTransition ? portalOpen : open}
      onOpenChange={handleOpenChange}
    >
      <DialogContent
        className={cn(
          "w-svw max-w-6xl! border-none bg-transparent p-0 shadow-none focus:ring-0 focus:outline-none md:w-[92vw] [&>button]:hidden",
          viewTransition && VIEW_TRANSITION_CONTENT_CLASS,
        )}
        data-create-task-modal-vt={viewTransition ? "" : undefined}
      >
        <TaskFormModalHeaderContext value={headerContextValue}>
          {viewTransition ? (
            <ViewTransition
              enter="create-task-modal-enter"
              exit="create-task-modal-exit"
              onExit={handleViewTransitionSettled}
              onUpdate={open ? undefined : handleViewTransitionSettled}
            >
              {open ? panel : null}
            </ViewTransition>
          ) : (
            panel
          )}
        </TaskFormModalHeaderContext>
      </DialogContent>
    </Dialog>
  );
}
