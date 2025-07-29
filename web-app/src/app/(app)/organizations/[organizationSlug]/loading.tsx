import DefaultLoading from "@/components/default-loading";

import { OrganizationInformationSkeleton } from "./components/organization-information";

export default function OrganizationLoadingPage() {
  return (
    <div className="container flex flex-col gap-8 p-8">
      <OrganizationInformationSkeleton />
      <DefaultLoading className="h-[300px] w-full border-none p-8" />
    </div>
  );
}
