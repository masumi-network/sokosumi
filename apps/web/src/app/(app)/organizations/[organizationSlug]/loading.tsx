import DefaultLoading from "@/components/default-loading";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

export default function OrganizationLoadingPage() {
  return (
    <div className="min-h-full w-full">
      <div className={cn(HOLDER_CLASS, "space-y-6 p-3")}>
        <DefaultLoading className="h-[300px] w-full border-none p-8" />
      </div>
    </div>
  );
}
