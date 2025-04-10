import { Skeleton } from "@/components/ui/skeleton";

export default function JobPageLoading() {
  return (
    <div className="flex w-full flex-col gap-4 rounded-md border p-4 lg:w-[max(400px,36%)]">
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
