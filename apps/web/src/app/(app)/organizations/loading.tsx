import { Skeleton } from "@/components/ui/skeleton";

import { OrganizationsSkeleton } from "./components/organizations";

export default function OrganizationsLoadingPage() {
  return (
    <div className="w-full space-y-12 px-2">
      <div className="flex w-full items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-32" />
      </div>
      <OrganizationsSkeleton />
    </div>
  );
}
