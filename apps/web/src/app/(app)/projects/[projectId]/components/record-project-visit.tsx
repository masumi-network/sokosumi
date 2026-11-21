"use client";

import { useRecordProjectVisit } from "@/hooks/effects/use-record-project-visit";
import { useSession } from "@/lib/auth/auth.client";

/**
 * Writes this project to the reader's visit log, which is how the sidebar
 * ranks its Projects disclosure. Renders nothing.
 *
 * Waits for the session so the write lands on that user and workspace, not a
 * shared browser log. Opening another project remounts via the layout `key`.
 */
export function RecordProjectVisit({ projectId }: { projectId: string }) {
  const { data: session } = useSession();
  const userId = session?.user.id;
  const organizationId = session?.session.activeOrganizationId ?? null;

  useRecordProjectVisit(projectId, userId, organizationId);

  return null;
}
