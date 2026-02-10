import { Skeleton } from "@/components/ui/skeleton";

import { OrganizationsSkeleton } from "./components/organizations";

export default function OrganizationsLoadingPage() {
  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-12 px-4">
        <div className="flex w-full items-center justify-between">
          <div />
          <Skeleton className="h-7 w-28" />
        </div>
        <OrganizationsSkeleton />
      </div>
    </div>
  );
}
