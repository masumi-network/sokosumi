import { TagIcon } from "@/components/agents/tag-icon";
import { Badge } from "@/components/ui/badge";

interface AgentBadgeCloudProps {
  tags: string[];
}

function AgentBadgeCloud({ tags }: AgentBadgeCloudProps) {
  return (
    <>
      {tags.length > 0 && (
        <div className="flex h-5.5 flex-wrap gap-2 overflow-hidden">
          {tags.map((tag) => (
            <Badge key={tag} variant="muted" className="h-5.5 max-w-full gap-1">
              <TagIcon name={tag} size={12} />
              <p className="truncate">{tag}</p>
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}

export { AgentBadgeCloud };
