"use client";

import { usePathname } from "next/navigation";
import { useCanonicalHistoryPath } from "@/hooks/effects/use-canonical-history-path";
import { isUuidString } from "@/lib/utils/uuid";

interface TaskCanonicalUrlProps {
  href: string;
}

/**
 * Rewrites the address bar to the task's canonical URL (`/tasks/SOK-12-slug`)
 * when it was opened by bare identifier or a stale slug. History only: no
 * navigation and no second server render.
 *
 * UUID paths stay put. Short identifiers are only unique inside a workspace,
 * and the detail page can only offer a workspace switch for UUIDs. Rewriting
 * a UUID bookmark into `SOK-12` would open the wrong task (or 404) after a
 * workspace change.
 *
 * Runs on the bare detail path only, so it never touches `/tasks/{id}/edit`
 * while the edit modal is layered over this page.
 */
export function TaskCanonicalUrl({ href }: TaskCanonicalUrlProps) {
  const pathname = usePathname();
  const match = pathname.match(/^\/tasks\/([^/]+)\/?$/);
  const ref = match?.[1];
  const targetPathname = ref && !isUuidString(ref) ? href : null;

  // Syncs with the browser history, an external system. Runs after every
  // render: a router refresh (RefreshPrefetchedPage) writes the router's own
  // URL back into history when it commits, so the rewrite must follow it.
  useCanonicalHistoryPath(targetPathname);

  return null;
}
