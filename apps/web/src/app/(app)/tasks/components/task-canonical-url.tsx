"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
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

  // Syncs with the browser history, an external system. Re-runs when the path
  // changes (edit modal closing) or a rename changes the slug.
  useEffect(() => {
    const match = pathname.match(/^\/tasks\/([^/]+)\/?$/);
    if (!match) return;

    const ref = match[1];
    if (isUuidString(ref)) return;
    if (pathname === href) return;

    const { search, hash } = window.location;
    window.history.replaceState(
      window.history.state,
      "",
      `${href}${search}${hash}`,
    );
  }, [pathname, href]);

  return null;
}
