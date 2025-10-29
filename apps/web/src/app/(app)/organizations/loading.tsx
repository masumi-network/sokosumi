import { Skeleton } from "@/components/ui/skeleton";

import { OrganizationsSkeleton } from "./components/organizations";

export default function OrganizationsLoadingPage() {
  return (
    <div className="container flex flex-col gap-8 md:p-8">
      <div className="flex w-full items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-32" />
      </div>
      <OrganizationsSkeleton />
    </div>
  );
}
