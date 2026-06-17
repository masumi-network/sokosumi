"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { HistorySearchDialog } from "@/app/components/history-search-dialog";
import useIsApplePlatform from "@/hooks/use-is-apple-platform";

interface HistorySearchContextValue {
  openHistorySearch: () => void;
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

interface HistorySearchDialogProviderProps {
  activeOrganizationId: string | null;
  children: ReactNode;
}

export function HistorySearchDialogProvider({
  activeOrganizationId,
  children,
}: HistorySearchDialogProviderProps) {
  const tSearch = useTranslations("App.HistorySearchDialog");
  const tHistory = useTranslations("App.History");
  const [open, setOpen] = useState(false);
  const isApplePlatform = useIsApplePlatform();
  const searchShortcutLabel = isApplePlatform ? "⌘K" : "Ctrl+K";

  const openHistorySearch = useCallback(() => {
    setOpen(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }

      if (
        event.key?.toLowerCase() !== "k" ||
        !(event.metaKey || event.ctrlKey)
      ) {
        return;
      }

      event.preventDefault();
      openHistorySearch();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openHistorySearch]);

  return (
    <HistorySearchContext.Provider
      value={{ openHistorySearch, searchShortcutLabel }}
    >
      {children}
      <HistorySearchDialog
        open={open}
        onOpenChange={setOpen}
        activeOrganizationId={activeOrganizationId}
        labels={{
          dialogTitle: tSearch("title"),
          dialogDescription: tSearch("description"),
          searchPlaceholder: tSearch("searchPlaceholder"),
          empty: tSearch("empty"),
          loading: tSearch("loading"),
          error: tSearch("error"),
          kind: {
            task: tHistory("Row.kind.task"),
            job: tHistory("Row.kind.job"),
            conversation: tHistory("Row.kind.conversation"),
          },
          conversationStatus: {
            active: tHistory("Row.conversationStatus.active"),
            archived: tHistory("Row.conversationStatus.archived"),
          },
        }}
      />
    </HistorySearchContext.Provider>
  );
}
