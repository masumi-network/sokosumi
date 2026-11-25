"use client";

import { Maximize2, Minimize2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** `undefined` outside a TaskFormModal; inside, the header slot once mounted. */
const TaskFormModalHeaderContext = createContext<
  HTMLDivElement | null | undefined
>(undefined);

export function TaskFormModalHeaderStart({
  children,
  inlineOutsideModal = false,
}: {
  children: React.ReactNode;
  /** Render in place when no TaskFormModal header exists to portal into. */
  inlineOutsideModal?: boolean;
}) {
  const host = useContext(TaskFormModalHeaderContext);
  if (host === undefined) return inlineOutsideModal ? children : null;
  return host ? createPortal(children, host) : null;
}

export function isTaskFormPortalEventTarget(
  target: EventTarget | null,
): boolean {
  return (
    target instanceof Element &&
    target.closest("[data-task-form-portal]") !== null
  );
}

interface TaskFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  cancelLabel: string;
  children: React.ReactNode;
  isDismissDisabled?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  /** `composer` is the compact New Task window: breadcrumb header, expand
   *  and close in the corner. `sheet` is the large form used for editing. */
  variant?: "sheet" | "composer";
  /** Composer only: true when closing would throw away typed text. */
  hasUnsavedText?: () => boolean;
}

export function TaskFormModal({
  open,
  onOpenChange,
  title,
  cancelLabel,
  children,
  isDismissDisabled = false,
  onOpenAutoFocus,
  onCloseAutoFocus,
  variant = "sheet",
  hasUnsavedText,
}: TaskFormModalProps) {
  if (variant === "composer") {
    return (
      <TaskComposerModal
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        cancelLabel={cancelLabel}
        isDismissDisabled={isDismissDisabled}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        hasUnsavedText={hasUnsavedText}
      >
        {children}
      </TaskComposerModal>
    );
  }
  return (
    <TaskSheetModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      cancelLabel={cancelLabel}
      isDismissDisabled={isDismissDisabled}
      onOpenAutoFocus={onOpenAutoFocus}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {children}
    </TaskSheetModal>
  );
}

function TaskComposerModal({
  open,
  onOpenChange,
  title,
  cancelLabel,
  children,
  isDismissDisabled = false,
  onOpenAutoFocus,
  onCloseAutoFocus,
  hasUnsavedText,
}: Omit<TaskFormModalProps, "variant">) {
  const [headerStartHost, setHeaderStartHost] = useState<HTMLDivElement | null>(
    null,
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  // Where the person was typing, so "Keep editing" puts them back there.
  const focusBeforeConfirmRef = useRef<HTMLElement | null>(null);
  const t = useTranslations("App.Tasks.Composer");

  // Clicking outside / pressing Escape closes the modal, except while a submit
  // or upload is in flight (guarded by isDismissDisabled). Typed text is never
  // thrown away without asking.
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isDismissDisabled) return;
    if (!nextOpen && hasUnsavedText?.()) {
      focusBeforeConfirmRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setIsConfirmingDiscard(true);
      return;
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        data-expanded={isExpanded}
        className={cn(
          "flex h-dvh w-svw max-w-none! flex-col gap-0 rounded-none border-0 p-0 outline-none sm:max-w-none!",
          "md:h-auto md:max-h-[min(640px,85dvh)] md:min-h-80 md:w-[min(768px,92vw)] md:rounded-xl md:border",
          "md:data-[expanded=true]:h-[min(860px,90dvh)] md:data-[expanded=true]:max-h-none md:data-[expanded=true]:w-[min(1120px,92vw)]",
        )}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        onPointerDownOutside={(event) => {
          if (isTaskFormPortalEventTarget(event.detail.originalEvent.target)) {
            event.preventDefault();
          }
        }}
        onFocusOutside={(event) => {
          if (isTaskFormPortalEventTarget(event.detail.originalEvent.target)) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isTaskFormPortalEventTarget(event.detail.originalEvent.target)) {
            event.preventDefault();
          }
        }}
      >
        <DialogDescription className="sr-only">
          {t("dialogDescription")}
        </DialogDescription>
        <TaskFormModalHeaderContext value={open ? headerStartHost : null}>
          <div className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-3 md:pl-4">
            <div
              ref={setHeaderStartHost}
              className="flex min-w-0 items-center empty:hidden"
            />
            <DialogTitle className="text-muted-foreground truncate px-1 text-sm font-medium">
              {title}
            </DialogTitle>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hidden size-10 md:inline-flex md:size-8"
                aria-label={isExpanded ? t("collapse") : t("expand")}
                aria-pressed={isExpanded}
                onClick={() => setIsExpanded((current) => !current)}
              >
                {isExpanded ? (
                  <Minimize2 className="size-4" aria-hidden />
                ) : (
                  <Maximize2 className="size-4" aria-hidden />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground size-10 md:size-8"
                aria-label={cancelLabel}
                disabled={isDismissDisabled}
                onClick={() => handleOpenChange(false)}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </TaskFormModalHeaderContext>
        <AlertDialog
          open={isConfirmingDiscard}
          onOpenChange={setIsConfirmingDiscard}
        >
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              const target = focusBeforeConfirmRef.current;
              if (target?.isConnected) {
                event.preventDefault();
                target.focus();
              }
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{t("discardTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("discardDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("keepEditing")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setIsConfirmingDiscard(false);
                  onOpenChange(false);
                }}
              >
                {t("discard")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function TaskSheetModal({
  open,
  onOpenChange,
  title,
  cancelLabel,
  children,
  isDismissDisabled = false,
  onOpenAutoFocus,
  onCloseAutoFocus,
}: Omit<TaskFormModalProps, "variant" | "hasUnsavedText">) {
  const [headerStartHost, setHeaderStartHost] = useState<HTMLDivElement | null>(
    null,
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isDismissDisabled) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-svw max-w-6xl! border-none bg-transparent p-0 shadow-none focus:ring-0 focus:outline-none md:w-[92vw] [&>button]:hidden"
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        onPointerDownOutside={(event) => {
          if (isTaskFormPortalEventTarget(event.detail.originalEvent.target)) {
            event.preventDefault();
          }
        }}
        onFocusOutside={(event) => {
          if (isTaskFormPortalEventTarget(event.detail.originalEvent.target)) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isTaskFormPortalEventTarget(event.detail.originalEvent.target)) {
            event.preventDefault();
          }
        }}
      >
        <DialogDescription className="hidden" />
        <TaskFormModalHeaderContext value={open ? headerStartHost : null}>
          <div className="bg-background flex h-dvh w-svw flex-col overflow-hidden rounded-none md:h-[min(760px,90dvh)] md:w-auto md:rounded-xl md:border md:border-border md:shadow-lg">
            <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center px-6 py-3 md:px-8">
              <div ref={setHeaderStartHost} className="justify-self-start" />
              <DialogTitle className="text-base font-semibold">
                {title}
              </DialogTitle>
              <div className="justify-self-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenChange(false)}
                  disabled={isDismissDisabled}
                >
                  <span className="text-foreground text-sm">{cancelLabel}</span>
                </Button>
              </div>
            </div>
            <div className="shrink-0 border-t" />
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </div>
        </TaskFormModalHeaderContext>
      </DialogContent>
    </Dialog>
  );
}
