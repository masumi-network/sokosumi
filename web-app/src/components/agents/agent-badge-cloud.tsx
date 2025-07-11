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
        <div className="flex flex-wrap gap-2">
          {refinedTags.map((tag) => (
            <Badge key={tag} variant="secondary">
              <p
                className={cn("uppercase", {
                  "max-w-32 truncate": truncate,
                })}
              >
                {tag}
              </p>
            </Badge>
          ))}
        </div>
      )}
    </>
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

export { AgentBadgeCloud, AgentBadgeCloudSkeleton };
