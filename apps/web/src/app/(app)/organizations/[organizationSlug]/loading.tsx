import DefaultLoading from "@/components/default-loading";

export default function OrganizationLoadingPage() {
  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-12 px-4">
        <DefaultLoading className="h-[300px] w-full border-none p-8" />
      </div>
    </div>
  );
}
