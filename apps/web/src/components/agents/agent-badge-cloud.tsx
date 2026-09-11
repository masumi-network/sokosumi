import { TagIcon } from "@/components/agents/tag-icon";
import { Badge } from "@/components/ui/badge";

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
              className="h-[22px] max-w-full gap-1"
            >
              <TagIcon name={tag} size={12} />
              <p className="truncate uppercase">{tag}</p>
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}

export { AgentBadgeCloud };
