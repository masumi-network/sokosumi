import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface RequiredEmailDomainsProps {
  requiredEmailDomains: string[];
}

export default function RequiredEmailDomains({
  requiredEmailDomains,
}: RequiredEmailDomainsProps) {
  const t = useTranslations("App.Organizations.OrganizationDetail");

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground">{t("requiredEmailDomains")}</p>
      <div className="flex flex-wrap items-center gap-2">
        {requiredEmailDomains.map((domain) => (
          <Badge key={domain}>{domain}</Badge>
        ))}
      </div>
    </div>
  );
}

export function RequiredEmailDomainsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-20" />
      <div className="flex flex-wrap items-center gap-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-4 w-20" />
        ))}
      </div>
    </div>
  );
}
