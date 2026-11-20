"use client";

import { type ReactNode, useContext, useSyncExternalStore } from "react";
import {
  PageListSearchContext,
  usePageSearchPagination,
} from "@/components/page-list-search";
import { cn } from "@/lib/utils";
import type { StudioStateHook } from "./use-studio-state";

// At Tailwind's lg breakpoint the assistant sits beside the gallery. Below it, the assistant replaces it.
const SPLIT_VIEW = "(min-width: 64rem)";

function subscribeToWidth(update: () => void) {
  const media = window.matchMedia(SPLIT_VIEW);
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}

const splitView = () => window.matchMedia(SPLIT_VIEW).matches;
const serverSplitView = () => false;

export function StudioGalleryColumn({
  assistantOpen,
  showsNothing,
  studio,
  children,
}: {
  assistantOpen: boolean;
  showsNothing: boolean;
  studio: StudioStateHook;
  children: ReactNode;
}) {
  const search = useContext(PageListSearchContext);
  const wide = useSyncExternalStore(
    subscribeToWidth,
    splitView,
    serverSplitView,
  );
  const hidden = assistantOpen && !wide;
  usePageSearchPagination(
    !hidden && studio.hasOlder ? studio.state.nextCursor?.id : null,
    studio.isRefreshing,
    studio.loadOlder,
  );
  return (
    <PageListSearchContext.Provider value={hidden ? null : search}>
      <div
        hidden={hidden}
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col",
          assistantOpen ? "hidden lg:flex" : "flex",
          showsNothing &&
            "relative isolate overflow-y-auto max-md:overflow-y-auto",
        )}
      >
        {children}
      </div>
    </PageListSearchContext.Provider>
  );
}
