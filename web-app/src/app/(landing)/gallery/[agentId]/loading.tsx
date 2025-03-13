import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="container mx-auto px-4 pb-8">
      <div className="space-y-4">
        {/* Agent Summary */}
        <div className="flex h-48 w-full overflow-hidden">
          <div className="relative h-full w-48">
            <Skeleton className="h-full w-full rounded-md" />
          </div>
          <div className="flex flex-1 flex-col px-6 py-2">
            <div>
              <Skeleton className="h-8 w-48" />
              <Skeleton className="mt-1 h-5 w-32" />
              <Skeleton className="mt-1 h-5 w-24" />
            </div>
            <div className="mt-auto flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-24" />
              </div>
            </div>
          </div>
        </div>

        {/* Badge Cloud */}
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="h-6 w-16 rounded-full" />
          ))}
        </div>

        {/* Description */}
        <div className="text-muted-foreground">
          <Skeleton className="h-4 w-full max-w-3xl" />
          <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
          <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
        </div>

        {/* Example Output */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {[1, 2, 3].map((index) => (
            <Skeleton
              key={index}
              className="h-64 w-auto flex-shrink-0 rounded-lg"
            />
          ))}
        </div>

        {/* Legal Links */}
        <div className="text-muted-foreground flex flex-wrap gap-6 text-sm">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    </div>
  );
}
