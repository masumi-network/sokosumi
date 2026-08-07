import { HistoryPageSkeleton } from "@/app/history/components/history-loading-view";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function HistoryLoading() {
  return <HistoryPageSkeleton />;
}
