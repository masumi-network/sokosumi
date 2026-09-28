"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TaskTagId } from "@/lib/clients/generated/core";

interface DraftInput {
  name: string;
  description: string;
  workspaceKey: string;
  enabled: boolean;
}

interface Suggestion {
  inputKey: string;
  wordKey: string;
  tags: TaskTagId[];
  receipt: string;
}

/**
 * Keep in step with `MIN_TASK_TAG_SUGGESTION_CHARACTERS` in Core's
 * `task-tag-suggestion.schema.ts`. A client gate above Core's would hide working
 * suggestions; a gate below it would spend a request on a guaranteed 422.
 */
const MIN_CHARACTERS = 15;
/** First request after a pause. */
const DEBOUNCE_MS = 1_200;
/**
 * Spacing between requests once one has been spent. The per-user limit is 6 a
 * minute, so 10s is exactly that budget: a low content gate must not let ordinary
 * stop-start typing exhaust the window and leave a composer with nothing.
 */
const REQUEST_INTERVAL_MS = 10_000;
/** Client-side ceiling on one suggestion request. */
const REQUEST_TIMEOUT_MS = 15_000;

export function useTaskTagSuggestions({
  name,
  description,
  workspaceKey,
  enabled,
}: DraftInput) {
  const normalizedName = name.trim().replace(/\s+/g, " ");
  const normalizedDescription = description.trim().replace(/\s+/g, " ");
  const input = { name: normalizedName, description: normalizedDescription };
  const inputKey = JSON.stringify([workspaceKey, input]);
  const words =
    `${input.name}\n${input.description}`
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const wordKey = JSON.stringify([
    workspaceKey,
    normalizedName.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [],
    normalizedDescription.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [],
  ]);
  const eligible =
    enabled &&
    words.join("").length >= MIN_CHARACTERS &&
    name.length <= 300 &&
    description.length <= 8000;
  const generation = useRef(0);
  useLayoutEffect(() => {
    generation.current += 1;
  }, [wordKey, eligible]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [request, setRequest] = useState<{
    key: string;
    status: "loading" | "unavailable";
  } | null>(null);
  const [settled, setSettled] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const attempted = useRef(new Set<string>());
  const nextRequestAt = useRef(0);
  const failures = useRef(0);
  const current =
    eligible && suggestion?.wordKey === wordKey ? suggestion : null;
  const tags = [...new Set(current?.tags ?? [])].slice(0, 5);

  useEffect(() => {
    if (!eligible || inFlight.current || attempted.current.has(wordKey)) return;
    const requestGeneration = generation.current;
    const isCurrent = () =>
      mounted.current && requestGeneration === generation.current;
    const timer = window.setTimeout(
      async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        attempted.current.add(wordKey);
        nextRequestAt.current = Date.now() + REQUEST_INTERVAL_MS;
        setRequest({ key: wordKey, status: "loading" });
        controller.current = new AbortController();
        const timeout = window.setTimeout(
          () => controller.current?.abort(),
          REQUEST_TIMEOUT_MS,
        );
        try {
          const response = await fetch("/api/tasks/tag-suggestions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: normalizedName,
              description: normalizedDescription,
            }),
            signal: controller.current.signal,
          });
          if (response.ok) {
            const value: Pick<Suggestion, "tags" | "receipt"> =
              await response.json();
            failures.current = 0;
            if (isCurrent()) {
              setSuggestion({ inputKey, wordKey, ...value });
              setRequest(null);
            }
          } else {
            failures.current += 1;
            nextRequestAt.current =
              Date.now() +
              Math.max(
                (Number(response.headers.get("Retry-After")) || 30) * 1000,
                Math.min(300000, 30000 * 2 ** (failures.current - 1)),
              );
            if (isCurrent())
              setRequest({ key: wordKey, status: "unavailable" });
          }
        } catch {
          failures.current += 1;
          nextRequestAt.current =
            Date.now() + Math.min(300000, 30000 * 2 ** (failures.current - 1));
          if (isCurrent()) setRequest({ key: wordKey, status: "unavailable" });
        } finally {
          window.clearTimeout(timeout);
          controller.current = null;
          inFlight.current = false;
          // A newer input may have been waiting for this single in-flight request.
          if (mounted.current) {
            if (!isCurrent())
              setRequest((current) =>
                current?.key === wordKey ? null : current,
              );
            setSettled((value) => value + 1);
          }
        }
      },
      Math.max(DEBOUNCE_MS, nextRequestAt.current - Date.now()),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    eligible,
    inputKey,
    wordKey,
    normalizedName,
    normalizedDescription,
    settled,
  ]);

  return {
    tags,
    /**
     * Tags are a quiet convenience, so the composer only ever shows that a
     * suggestion is on its way. An outage, a policy rejection, a timeout or a rate
     * limit is tracked here for backoff and shown as nothing at all: Core tags the
     * task on its next `/sync/task-tags` tick either way.
     */
    status:
      enabled && request?.key === wordKey && request.status === "loading"
        ? ("loading" as const)
        : null,
    tagSuggestionReceipt:
      current?.inputKey === inputKey ? current.receipt : undefined,
  };
}
