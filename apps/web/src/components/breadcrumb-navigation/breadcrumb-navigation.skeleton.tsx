import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";

export default function BreadcrumbNavigationSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <Skeleton className="h-3 w-12" />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <Skeleton className="h-3 w-12" />
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
