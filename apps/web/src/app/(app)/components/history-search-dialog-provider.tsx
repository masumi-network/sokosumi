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
import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";

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
  const tHistory = useTranslations("App.History");
  const [open, setOpen] = useState(false);
  const isApplePlatform = useIsApplePlatform();
  const searchShortcutLabel = isApplePlatform ? "⌘K" : "Ctrl+K";

  const openHistorySearch = useCallback(() => {
    setOpen(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
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
          updated: tHistory("Row.updated"),
        }}
      />
    </HistorySearchContext.Provider>
  );
}
