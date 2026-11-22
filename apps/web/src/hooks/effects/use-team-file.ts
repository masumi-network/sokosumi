"use client";

import { useEffect, useState } from "react";
import { parseTeam, type Team } from "@/lib/team-file";

export type TeamFileLoadState =
  | { status: "loading" }
  | { status: "ready"; team: Team }
  | { status: "failed" };

/**
 * Fetches and parses a `*.team.json` document from `url` with
 * `AbortController` cleanup for `TeamFileView`.
 */
export function useTeamFile(url: string): TeamFileLoadState {
  const [state, setState] = useState<TeamFileLoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Failed to fetch team");
        return response.json();
      })
      .then((json: unknown) => {
        const team = parseTeam(json);
        setState(team ? { status: "ready", team } : { status: "failed" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [url]);

  return state;
}
