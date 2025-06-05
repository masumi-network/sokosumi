import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface RequiredEmailDomainsProps {
  requiredEmailDomains: string[];
}

export function RequiredEmailDomains({
  requiredEmailDomains,
}: RequiredEmailDomainsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {requiredEmailDomains.map((domain) => (
        <Badge key={domain}>{domain}</Badge>
      ))}
    </div>
  );
}

export function RequiredEmailDomainsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-4 w-20" />
        ))}
      </div>
    </div>
  );
}
