"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { MarkNotificationsRead } from "@/components/notifications/mark-notifications-read.client";

export function OpenTaskResult({
  taskId,
  href,
  label,
}: {
  taskId: string;
  href: string;
  label: string;
}) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [href, router]);
  return (
    <>
      <MarkNotificationsRead kind="TASK" referenceId={taskId} />
      {/* Shown only until the redirect lands, or when scripts are off: a padded live line, not a bare link in the corner. */}
      <p role="status" className="p-4 text-sm">
        <a
          className="underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring rounded-sm outline-none"
          href={href}
        >
          {label}
        </a>
      </p>
    </>
  );
}
