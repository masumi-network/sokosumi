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
      <a className="underline" href={href}>
        {label}
      </a>
    </>
  );
}
