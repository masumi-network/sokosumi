import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface RequiredEmailDomainsProps {
  requiredEmailDomains: string[];
  className?: string | undefined;
}

export function RequiredEmailDomains({
  requiredEmailDomains,
  className,
}: RequiredEmailDomainsProps) {
  const t = useTranslations("Components.Organizations.RequiredEmailDomains");

  if (requiredEmailDomains.length === 0) {
    return (
      <span className={cn("text-base font-medium", className)}>
        {t("restrictAll")}
      </span>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
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
