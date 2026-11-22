"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { HistorySearchDialog } from "@/app/components/history-search-dialog";
import { useEventListener } from "@/hooks/effects/use-event-listener";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";

interface HistorySearchContextValue {
  /** `opener` gets focus back when the dialog closes. */
  openHistorySearch: (opener?: HTMLElement | null) => void;
  searchShortcutLabel: string;
}

const HistorySearchContext = createContext<HistorySearchContextValue | null>(
  null,
);

export function useHistorySearch() {
  const context = useContext(HistorySearchContext);
  if (!context) {
    throw new Error(
      "useHistorySearch must be used within HistorySearchDialogProvider.",
    );
  }

  return context;
}

/**
 * Soft read for layout chrome that may SSR under the app Suspense fallback
 * (`AppShellLoadingFrame`) before `HistorySearchDialogProvider` mounts.
 * Instant Navigations validation uses that path — throwing there drops the
 * page segment and fails `instant` checks.
 */
export function useOptionalHistorySearch(): HistorySearchContextValue | null {
  return useContext(HistorySearchContext);
}

interface HistorySearchDialogProviderProps {
  activeOrganizationId: string | null;
  children: ReactNode;
}

export function HistorySearchDialogProvider({
  activeOrganizationId,
  children,
}: HistorySearchDialogProviderProps) {
  const tSearch = useTranslations("App.HistorySearchDialog");
  const [open, setOpen] = useState(false);
  const isApplePlatform = useIsApplePlatform();
  const searchShortcutLabel = isApplePlatform ? "⌘K" : "Ctrl+K";

  // The dialog has no DialogTrigger, so Radix cannot return focus itself.
  const openerRef = useRef<HTMLElement | null>(null);

  const openHistorySearch = useCallback(
    (opener?: HTMLElement | null) => {
      // Already open (⌘K again): keep the original opener, not a dialog control.
      if (open) return;
      openerRef.current =
        opener ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
      setOpen(true);
    },
    [open],
  );

  const restoreOpenerFocus = useCallback((event: Event) => {
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) {
      event.preventDefault();
      opener.focus();
    }
  }, []);

  useEventListener("window", "keydown", (event) => {
    if (isEditableKeyboardTarget(event.target)) {
      return;
    }

    if (event.key?.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) {
      return;
    }

    event.preventDefault();
    openHistorySearch();
  });

  return (
    <HistorySearchContext.Provider
      value={{ openHistorySearch, searchShortcutLabel }}
    >
      {children}
      <HistorySearchDialog
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={restoreOpenerFocus}
        activeOrganizationId={activeOrganizationId}
        labels={{
          dialogTitle: tSearch("title"),
          dialogDescription: tSearch("description"),
          searchPlaceholder: tSearch("searchPlaceholder"),
          empty: tSearch("empty"),
          loading: tSearch("loading"),
          error: tSearch("error"),
          created: tSearch("created"),
          filesGroup: tSearch("filesGroup"),
          filesSeeAll: tSearch("filesSeeAll"),
          filesFilenameMatch: tSearch("filesFilenameMatch"),
          peopleGroup: tSearch("peopleGroup"),
          copyEmail: (email) => tSearch("copyEmail", { email }),
          emailCopied: tSearch("emailCopied"),
          emailCopyFailed: tSearch("emailCopyFailed"),
          mentionInTask: (name) => tSearch("mentionInTask", { name }),
          tagsGroup: tSearch("tagsGroup"),
          tagTasksGroup: (tag) => tSearch("tagTasksGroup", { tag }),
          tagsError: tSearch("tagsError"),
          tagTasksError: tSearch("tagTasksError"),
          projectsGroup: tSearch("projectsGroup"),
          channelsGroup: tSearch("channelsGroup"),
          schedulesGroup: tSearch("schedulesGroup"),
          coworkersGroup: tSearch("coworkersGroup"),
          newTask: tSearch("newTask"),
          newTaskWith: (name) => tSearch("newTaskWith", { name }),
        }}
      />
    </HistorySearchContext.Provider>
  );
}
