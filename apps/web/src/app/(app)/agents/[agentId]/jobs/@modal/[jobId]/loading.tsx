import DefaultLoading from "@/components/default-loading";

export default function JobDetailsModalLoading() {
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="bg-background/50 absolute inset-0 backdrop-blur-lg" />
      <div className="absolute inset-0 md:grid md:place-items-center">
        <div className="bg-background min-h-svh w-svw p-4 md:min-h-0 md:w-[80vw] md:max-w-3xl md:rounded-xl md:p-6">
          <DefaultLoading className="h-[60svh] min-h-[300px] w-full p-0" />
        </div>
      </div>
    </div>
  );
}
