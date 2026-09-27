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
    words.join("").length >= 40 &&
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
  const [corrections, setCorrections] = useState<{
    scope: string;
    add: TaskTagId[];
    remove: TaskTagId[];
  }>({ scope: workspaceKey, add: [], remove: [] });
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
  const manual: { add: TaskTagId[]; remove: TaskTagId[] } =
    corrections.scope === workspaceKey ? corrections : { add: [], remove: [] };
  const current =
    eligible && suggestion?.wordKey === wordKey ? suggestion : null;
  const tags = [...new Set([...manual.add, ...(current?.tags ?? [])])]
    .filter((tag) => !manual.remove.includes(tag))
    .slice(0, 5);

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
        nextRequestAt.current = Date.now() + 5000;
        setRequest({ key: wordKey, status: "loading" });
        controller.current = new AbortController();
        const timeout = window.setTimeout(
          () => controller.current?.abort(),
          15000,
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
      Math.max(1200, nextRequestAt.current - Date.now()),
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

  function toggleTag(tag: TaskTagId, selected: boolean) {
    setCorrections((previous) => {
      const current: { add: TaskTagId[]; remove: TaskTagId[] } =
        previous.scope === workspaceKey ? previous : { add: [], remove: [] };
      return {
        scope: workspaceKey,
        add: selected
          ? [...new Set([...current.add, tag])]
          : current.add.filter((value) => value !== tag),
        remove: selected
          ? current.remove.filter((value) => value !== tag)
          : [...new Set([...current.remove, tag])],
      };
    });
  }

  return {
    tags,
    toggleTag,
    status: enabled && request?.key === wordKey ? request.status : null,
    tagSuggestionReceipt:
      current?.inputKey === inputKey ? current.receipt : undefined,
    tagCorrections:
      manual.add.length || manual.remove.length
        ? { add: manual.add, remove: manual.remove }
        : undefined,
  };
}
