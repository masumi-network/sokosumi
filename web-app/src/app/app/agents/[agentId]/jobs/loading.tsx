import { Skeleton } from "@/components/ui/skeleton";

export default function JobPageLoading() {
  return (
    <div className="job-table-width flex flex-col gap-4 rounded-xl border p-2">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center justify-around">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-32" />
        </div>
      ))}
    </div>
  );
}
