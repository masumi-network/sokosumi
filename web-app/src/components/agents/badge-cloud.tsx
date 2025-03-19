import { Badge } from "@/components/ui/badge";

function BadgeCloud({ tags }: { tags: string[] }) {
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

export { BadgeCloud };
