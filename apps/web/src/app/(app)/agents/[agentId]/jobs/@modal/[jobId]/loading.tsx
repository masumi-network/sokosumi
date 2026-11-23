import { JobDetailSkeleton } from "../../components/jobs-loading";

export default function JobDetailsModalLoading() {
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="bg-overlay absolute inset-0" />
      <div className="absolute inset-0 md:grid md:place-items-center">
        <div className="bg-background min-h-dvh w-svw p-4 md:min-h-0 md:w-[80vw] md:max-w-3xl md:rounded-xl md:p-6">
          <JobDetailSkeleton className="min-h-[60dvh] py-0" />
        </div>
      </div>
    </div>
  );
}
