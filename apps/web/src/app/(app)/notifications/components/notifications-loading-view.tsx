import { Skeleton } from "@/components/ui/skeleton";

/** The message widths the bones use, so no two rows read as one block. */
const ROW_WIDTHS = ["w-[82%]", "w-[68%]", "w-[90%]", "w-[74%]", "w-[60%]"];

/**
 * The rows themselves, without a frame, so the live list can wear the same
 * bones inside the card it is already in.
 *
 * The bones carry the row's geometry, not just its text: the 2px rail
 * gutter, the 32px disc and the two lines beside them. A skeleton that
 * dropped those made every message slide sideways the moment the real rows
 * arrived.
 * Sync only (no cookies/`connection()`/i18n).
 */
export function NotificationsSkeletonRows(): React.ReactElement {
  return (
    <div
      data-testid="notifications-loading-list"
      className="divide-border divide-y"
    >
      {ROW_WIDTHS.map((width, index) => (
        <div key={index} className="flex items-start">
          {/* The rail's width, unpainted: an unread bar here would claim a
              state the page has not loaded yet. */}
          <span className="w-0.5 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-1 items-start gap-3 p-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            {/* A bone stands for a line box, not for the ink in it: the
                message is text-sm (20px) over text-xs (16px), so a shorter
                bone leaves the row 6px short and the whole list jumps up
                when the live rows land. */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Skeleton className={`h-5 ${width}`} />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
          {/* The read toggle's box. It is `shrink-0` on a real row, so
              leaving it out here would hand the message ~56px the live row
              never gives it. */}
          <span className="w-14 shrink-0" aria-hidden />
        </div>
      ))}
    </div>
  );
}

/**
 * The view strip's bones. The live card grows a strip the moment the list
 * mounts, and without it every row below would step down by its height.
 */
function NotificationsFilterSkeleton(): React.ReactElement {
  // The triggers carry px-1 of their own, so px-5 and a 24px gap put the
  // bones on the same inline edges as the labels they stand for. The live
  // strip is 8 + 20 + 10 + a 2px active underline that pulls itself up by
  // 1px, which is 39px to this box's 38px, so the padding adds the last
  // pixel rather than letting the card step down when the strip mounts.
  return (
    <div className="border-border flex gap-6 border-b px-5 pt-2 pb-[0.6875rem]">
      <Skeleton className="h-5 w-8" />
      <Skeleton className="h-5 w-14" />
      <Skeleton className="h-5 w-20" />
    </div>
  );
}

/** List card bones for Instant `loading.tsx`. */
export function NotificationsListSkeleton(): React.ReactElement {
  return (
    <div className="bg-card-background border-border overflow-hidden rounded-xl border">
      <NotificationsFilterSkeleton />
      <NotificationsSkeletonRows />
    </div>
  );
}

/**
 * Sync Instant Nav shell for `/notifications`.
 */
export function NotificationsPageSkeleton(): React.ReactElement {
  return (
    <div
      data-testid="notifications-loading"
      className="flex flex-col gap-5 pb-4"
    >
      {/* The page heading's bones, so the card does not jump down the page
          when the live heading lands above it. */}
      <div className="flex flex-col gap-1">
        {/* The live heading is text-2xl over text-sm, which is a 32px line
            box over a 20px one with 4px between them. */}
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
      <NotificationsListSkeleton />
    </div>
  );
}
