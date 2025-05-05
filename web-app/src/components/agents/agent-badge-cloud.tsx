import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface AgentBadgeCloudProps {
  tags: string[];
}

function AgentBadgeCloud({ tags }: AgentBadgeCloudProps) {
  return (
    <>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
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
