import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import { DriveListSkeleton } from "@/app/drive/components/drive-list-skeleton";
import { cn } from "@/lib/utils";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function DriveLoading() {
  return (
    <div className={cn("w-full px-2", LIST_MOBILE_CREATE_FAB_CLEARANCE)}>
      <DriveListSkeleton />
    </div>
  );
}
