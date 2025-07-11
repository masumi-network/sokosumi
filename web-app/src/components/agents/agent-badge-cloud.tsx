import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface AgentBadgeCloudProps {
  tags: string[];
  limit?: number;
  truncate?: boolean;
}

function AgentBadgeCloud({
  tags,
  limit = undefined,
  truncate = false,
}: AgentBadgeCloudProps) {
  const refinedTags = tags.slice(0, limit);

  return (
    <>
      {refinedTags.length > 0 && (
        <div className="flex flex-wrap">
          {refinedTags.map((tag) => (
            <div key={tag} className="max-w-1/2 px-1">
              <Badge variant="secondary" className="w-full">
                <p
                  className={cn("uppercase", {
                    truncate: truncate,
                  })}
                >
                  {tag}
                </p>
              </Badge>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function AgentNewBadge() {
  const t = useTranslations("Components.Agents.AgentBadgeCloud");
  return (
    <Badge className="bg-background text-foreground">
      <p className="uppercase">{t("new")}</p>
    </Badge>
  );
}

function AgentBadgeCloudSkeleton() {
  return (
    <div className="flex flex-wrap gap-2">
      {[1, 2, 3].map((_, index) => (
        <Skeleton key={index} className="h-4 w-6 rounded-lg" />
      ))}
    </div>
  );
}

export { AgentBadgeCloud, AgentBadgeCloudSkeleton, AgentNewBadge };
