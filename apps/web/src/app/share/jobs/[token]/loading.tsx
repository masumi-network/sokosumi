import { APP_MAIN_MOBILE_PT_CLASS } from "@/app/components/app-shell-safe-area";
import DefaultLoading from "@/components/default-loading";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function JobPageLoading() {
  return (
    <div
      className={cn(
        "container mx-auto flex flex-col items-center justify-center p-4 md:p-8 md:pt-4",
        APP_MAIN_MOBILE_PT_CLASS,
      )}
    >
      <div className="mb-4 w-full space-y-4">
        <Skeleton className="h-8 w-48" />
      </div>
      <DefaultLoading className="bg-muted/50 h-full min-h-[300px] w-full flex-1 rounded-xl border p-8" />
    </div>
  );
}
