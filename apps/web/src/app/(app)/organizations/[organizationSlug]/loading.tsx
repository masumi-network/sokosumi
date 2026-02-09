import DefaultLoading from "@/components/default-loading";

export default function OrganizationLoadingPage() {
  return (
    <div className="container flex flex-col gap-8 p-8">
      <DefaultLoading className="h-[300px] w-full border-none p-8" />
    </div>
  );
}
