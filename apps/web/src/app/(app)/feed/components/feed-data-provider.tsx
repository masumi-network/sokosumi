"use client";

import { createContext, useContext, useMemo } from "react";

import type { FeedItem } from "@/lib/services/feed.service";

interface FeedDataContextValue {
  items: FeedItem[];
  jobsCursor: string | null;
  tasksCursor: string | null;
  hasMore: boolean;
  getItemById: (feedId: string) => FeedItem | null;
}

const FeedDataContext = createContext<FeedDataContextValue | null>(null);

interface FeedDataProviderProps {
  items: FeedItem[];
  jobsCursor: string | null;
  tasksCursor: string | null;
  hasMore: boolean;
  children: React.ReactNode;
}

export function FeedDataProvider({
  items,
  jobsCursor,
  tasksCursor,
  hasMore,
  children,
}: FeedDataProviderProps) {
  const value = useMemo<FeedDataContextValue>(() => {
    const itemsById = new Map(items.map((item) => [item.id, item]));

    return {
      items,
      jobsCursor,
      tasksCursor,
      hasMore,
      getItemById: (feedId: string) => itemsById.get(feedId) ?? null,
    };
  }, [hasMore, items, jobsCursor, tasksCursor]);

  return (
    <FeedDataContext.Provider value={value}>
      {children}
    </FeedDataContext.Provider>
  );
}

export function useFeedData(): FeedDataContextValue {
  const context = useContext(FeedDataContext);
  if (!context) {
    throw new Error("useFeedData must be used within FeedDataProvider");
  }

  return context;
}
