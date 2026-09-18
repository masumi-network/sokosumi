"use client";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { recordProjectVisit } from "@/hooks/use-recent-projects";

/**
 * Writes this project to the reader's visit log, which is how the sidebar
 * ranks its Projects disclosure. Renders nothing.
 *
 * Mount-only sync with browser storage: the layout gives it a `key` of the
 * project id, so opening another project remounts it and records that visit.
 */
export function RecordProjectVisit({ projectId }: { projectId: string }) {
  useMountEffect(() => {
    recordProjectVisit(projectId);
  });

  return null;
}
