import { NotificationsPageSkeleton } from "@/app/notifications/components/notifications-loading-view";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function NotificationsLoading() {
  return <NotificationsPageSkeleton />;
}
