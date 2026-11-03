import { Skeleton } from "@/components/ui/skeleton";

export default function NewsletterAnalyticsLoading() {
  return (
    <div aria-busy="true" className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-60 w-full" />
    </div>
  );
}
