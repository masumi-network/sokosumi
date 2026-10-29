"use client";

import { useQueryState } from "nuqs";
import { useTransition } from "react";

import { PROJECTS_LIST_STATES } from "@/app/projects/constants";
import { projectsSearchParams } from "@/app/projects/projects-query";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface ProjectsStateToggleLabels {
  label: string;
  open: string;
  closed: string;
}

/**
 * Drives the `state` search param, which the server page forwards to Core,
 * for the same reason `ProjectsFilter` drives `q`: the list pages with
 * "Load more", so only Core can split Open from Closed across every page.
 */
export function ProjectsStateToggle({
  labels,
}: {
  labels: ProjectsStateToggleLabels;
}) {
  const [, startTransition] = useTransition();
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
          {labels[option]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
