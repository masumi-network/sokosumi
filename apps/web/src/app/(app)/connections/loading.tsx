import { ConnectionsPageSkeleton } from "@/app/connections/components/connections-loading-view";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function ConnectionsLoading() {
  return <ConnectionsPageSkeleton />;
}
