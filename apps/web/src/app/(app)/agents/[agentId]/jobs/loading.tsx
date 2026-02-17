import DefaultLoading from "@/components/default-loading";

import JobsListLoading from "./components/jobs-list-loading";

export default function JobPageLoading() {
  return (
    <div className="h-full min-h-[300px] w-full flex-1 p-8">
      <div className="hidden w-72 shrink-0 lg:block">
        <JobsListLoading />
      </div>
      <div className="flex-1">
        <DefaultLoading className="h-full min-h-[300px] w-full flex-1 p-8" />
      </div>
    </div>
  );
}
