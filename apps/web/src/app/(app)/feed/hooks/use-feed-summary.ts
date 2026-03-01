"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { generateFeedSummary } from "@/app/feed/actions";
import { useSession } from "@/lib/auth/auth.client";
import type { FeedItem } from "@/lib/services/feed.service";

const FEED_SUMMARY_CACHE_PREFIX = "feed-summary:v1:";

interface FeedSummaryCacheEntry {
  summary: string;
  bullets: string[];
}

interface FeedSummaryResult {
  summary: string | null;
  bullets: string[];
  isGenerating: boolean;
  hasError: boolean;
  shouldAnimateStream: boolean;
}

function toCacheKey(items: FeedItem[], profileContext: string): string | null {
  const ids = items.slice(0, 5).map((item) => item.id);
  if (ids.length === 0) {
    return null;
  }

  return `${FEED_SUMMARY_CACHE_PREFIX}${profileContext}:${ids.join(",")}`;
}

function readCachedSummary(cacheKey: string): FeedSummaryCacheEntry | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const cachedRaw = window.localStorage.getItem(cacheKey);
    if (!cachedRaw) {
      return null;
    }

    const parsed = JSON.parse(cachedRaw) as Partial<FeedSummaryCacheEntry>;
    const summary =
      typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const bullets = Array.isArray(parsed.bullets)
      ? parsed.bullets
          .filter((bullet): bullet is string => typeof bullet === "string")
          .map((bullet) => bullet.trim())
          .filter((bullet) => bullet.length > 0)
      : [];
    if (!summary || bullets.length === 0) {
      return null;
    }

    return {
      summary,
      bullets: bullets.slice(0, 5),
    };
  } catch {
    return null;
  }
}

function writeCachedSummary(cacheKey: string, data: FeedSummaryCacheEntry) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(data));
  } catch {
    // Ignore localStorage write errors (quota, privacy mode, etc.).
  }
}

export function useFeedSummary(items: FeedItem[]): FeedSummaryResult {
  const { data: session } = useSession();
  const [summary, setSummary] = useState<string | null>(null);
  const [bullets, setBullets] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [shouldAnimateStream, setShouldAnimateStream] = useState(false);
  const [, startTransition] = useTransition();
  const requestIdRef = useRef(0);

  const sourceItems = useMemo(
    () =>
      items.slice(0, 5).map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        displayTitle: item.displayTitle,
        previewText: item.previewText,
        contentMarkdown: item.contentMarkdown,
        activityAt: item.activityAt,
        actor: {
          kind: item.actor.kind,
          name: item.actor.name,
        },
      })),
    [items],
  );
  const profileContext = useMemo(() => {
    const userId = session?.user?.id ?? "anonymous";
    const activeOrganizationId =
      session?.session?.activeOrganizationId ?? "none";
    return `${userId}:${activeOrganizationId}`;
  }, [session?.session?.activeOrganizationId, session?.user?.id]);
  const cacheKey = useMemo(
    () => toCacheKey(items, profileContext),
    [items, profileContext],
  );

  useEffect(() => {
    if (!cacheKey || sourceItems.length === 0) {
      return;
    }

    const cached = readCachedSummary(cacheKey);
    if (cached) {
      queueMicrotask(() => {
        setSummary(cached.summary);
        setBullets(cached.bullets);
        setHasError(false);
        setIsGenerating(false);
        setShouldAnimateStream(false);
      });
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    let isCancelled = false;
    queueMicrotask(() => {
      setHasError(false);
      setIsGenerating(true);
    });

    startTransition(() => {
      void (async () => {
        const result = await generateFeedSummary({ items: sourceItems });
        if (isCancelled || requestIdRef.current !== requestId) {
          return;
        }

        const nextSummary = result.summary.trim();
        const nextBullets = result.bullets
          .map((bullet) => bullet.trim())
          .filter((bullet) => bullet.length > 0)
          .slice(0, 5);

        if (nextSummary && nextBullets.length > 0) {
          setSummary(nextSummary);
          setBullets(nextBullets);
          setHasError(false);
          setShouldAnimateStream(true);
          writeCachedSummary(cacheKey, {
            summary: nextSummary,
            bullets: nextBullets,
          });
        } else {
          setSummary(null);
          setBullets([]);
          setHasError(true);
          setShouldAnimateStream(false);
        }

        setIsGenerating(false);
      })();
    });

    return () => {
      isCancelled = true;
    };
  }, [cacheKey, sourceItems, startTransition]);

  return {
    summary: cacheKey ? summary : null,
    bullets: cacheKey ? bullets : [],
    isGenerating: cacheKey ? isGenerating : false,
    hasError: cacheKey ? hasError : false,
    shouldAnimateStream: cacheKey ? shouldAnimateStream : false,
  };
}
