"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

interface TaskCanonicalUrlProps {
  href: string;
}

/**
 * Rewrites the address bar to the task's canonical URL (`/tasks/SOK-12-slug`)
 * when it was opened by uuid, bare identifier or a stale slug. History only:
 * no navigation and no second server render.
 *
 * Runs on the bare detail path only, so it never touches `/tasks/{id}/edit`
 * while the edit modal is layered over this page.
 */
export function TaskCanonicalUrl({ href }: TaskCanonicalUrlProps) {
  const pathname = usePathname();

  // Syncs with the browser history, an external system. Re-runs when the path
  // changes (edit modal closing) or a rename changes the slug.
  useEffect(() => {
    if (!/^\/tasks\/[^/]+\/?$/.test(pathname)) return;
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
