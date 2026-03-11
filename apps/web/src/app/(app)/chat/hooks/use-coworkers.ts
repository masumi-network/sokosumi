"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type DbCoworker,
  mapDbCoworkerToChatCoworker,
} from "@/app/chat/utils/coworker-utils";
import type { Coworker } from "@/app/chat/utils/types";

interface UseCoworkersReturn {
  coworkers: Coworker[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Fetches available coworkers from the API (DB-backed) and maps them to the chat Coworker type,
 * including resolved profile images. Requests only whitelisted coworkers with the chat capability
 * so the chat selection shows only coworkers that can be used for chat.
 */
export function useCoworkers(): UseCoworkersReturn {
  const [coworkers, setCoworkers] = useState<Coworker[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCoworkers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/coworkers?capability=chat", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { message?: string }).message ?? `HTTP ${res.status}`,
        );
      }
      const json = (await res.json()) as { data?: DbCoworker[] };
      const list = Array.isArray(json.data) ? json.data : [];
      setCoworkers(list.map(mapDbCoworkerToChatCoworker));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load coworkers");
      setCoworkers([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCoworkers();
  }, [fetchCoworkers]);

  return { coworkers, isLoading, error, refetch: fetchCoworkers };
}
