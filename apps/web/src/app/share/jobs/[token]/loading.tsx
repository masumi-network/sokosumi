import DefaultLoading from "@/components/default-loading";
import { Skeleton } from "@/components/ui/skeleton";

export default function JobPageLoading() {
  return (
    <div className="container mx-auto flex flex-col items-center justify-center md:p-8">
      <div className="mb-4 w-full space-y-4">
        <Skeleton className="h-8 w-48" />
      </div>
      <DefaultLoading className="bg-muted/50 h-full min-h-[300px] w-full flex-1 rounded-xl border p-8" />
    </div>
  );
}
