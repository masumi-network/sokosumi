import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface AgentBadgeCloudProps {
  tags: string[];
}

function AgentBadgeCloud({ tags }: AgentBadgeCloudProps) {
  return (
    <>
      {tags.length > 0 && (
        <div className="flex h-[22px] flex-wrap gap-2 overflow-hidden">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="h-[22px] max-w-full"
            >
              <p className="truncate uppercase">{tag}</p>
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}

function AgentNewBadge() {
  const t = useTranslations("Components.Agents.AgentBadgeCloud");
  return (
    <Badge className="bg-background text-foreground h-[22px]">
      <p className="uppercase">{t("new")}</p>
    </Badge>
  );
}

function AgentBadgeCloudSkeleton() {
  return (
    <div className="flex flex-wrap gap-2">
      {[1, 2, 3].map((_, index) => (
        <Skeleton key={index} className="h-[22px] w-6 rounded-lg" />
      ))}
    </div>
  );
}

export { AgentBadgeCloud, AgentBadgeCloudSkeleton, AgentNewBadge };
