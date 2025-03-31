import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col items-start gap-6 p-8 sm:p-20">
      {/* Title skeleton */}
      <Skeleton className="h-10 w-48" />

      {/* Table skeleton */}
      <div className="w-full rounded-md border">
        {/* Table header skeleton */}
        <div className="bg-background sticky top-0 z-10">
          <div className="flex border-b p-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="mx-2 h-8 w-32" />
            ))}
          </div>
        </div>

        {/* Table rows skeleton */}
        <div className="flex-1">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="flex border-b p-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="mx-2 h-6 w-32" />
              ))}
            </div>
          ))}
        </div>

        {/* Pagination skeleton */}
        <div className="flex items-center justify-between p-4">
          <Skeleton className="h-8 w-48" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
