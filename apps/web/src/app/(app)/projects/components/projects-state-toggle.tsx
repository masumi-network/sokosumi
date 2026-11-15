"use client";

import { Loader2 } from "lucide-react";
import { useQueryState } from "nuqs";
import type { TransitionStartFunction } from "react";

import { PROJECTS_LIST_STATES } from "@/app/projects/constants";
import { projectsSearchParams } from "@/app/projects/projects-query";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface ProjectsStateToggleLabels {
  label: string;
  open: string;
  hidden: string;
  closed: string;
}

/**
 * Drives the `state` search param, which the server page forwards to Core,
 * for the same reason `ProjectsFilter` drives `q`: the list pages with
 * "Load more", so only Core can split Open, Hidden and Closed across every
 * page.
 *
 * `ProjectsView` owns the transition so it can mark the list busy while the
 * chosen view loads; `pending` puts a spinner in that segment.
 */
export function ProjectsStateToggle({
  labels,
  pending = false,
  startTransition,
}: {
  labels: ProjectsStateToggleLabels;
  pending?: boolean;
  startTransition: TransitionStartFunction;
}) {
  const [state, setState] = useQueryState(
    "state",
    projectsSearchParams.state.withOptions({
      shallow: false,
      clearOnDefault: true,
      startTransition,
    }),
  );

  return (
    <ToggleGroup
      aria-label={labels.label}
      type="single"
      value={state}
      onValueChange={(value) => {
        // Clicking the selected view again would clear it; keep it.
        const next = PROJECTS_LIST_STATES.find((option) => option === value);
        if (next) void setState(next);
      }}
      className="shrink-0"
    >
      {PROJECTS_LIST_STATES.map((option) => (
        <ToggleGroupItem key={option} value={option}>
          {/* Not on phones: the extra width squeezed the filter beside it;
              the dimmed list and its bar still show the load there. */}
          {pending && option === state ? (
            <Loader2
              data-testid="projects-state-pending"
              className="size-3.5 animate-spin motion-reduce:animate-pulse max-sm:hidden"
              aria-hidden
            />
          ) : null}
          {labels[option]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
