import { Skeleton } from "@/components/ui/skeleton";

import { OrganizationsSkeleton } from "./components/organizations";

export default function OrganizationsLoadingPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-8 p-8">
      <div className="flex w-full items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="container mx-auto">
        <OrganizationsSkeleton />
      </div>
    </div>
  );
}
