import { OrganizationInformationSkeleton } from "./components/organization-information";

export default function OrganizationLoadingPage() {
  return (
    <div className="container flex flex-col gap-8 p-8">
      <OrganizationInformationSkeleton />
    </div>
  );
}
