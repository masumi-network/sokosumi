import { Badge } from "@/components/ui/badge";

function BadgeCloud({ tagNames }: { tagNames: string[] }) {
  return (
    <>
      {tagNames.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tagNames.map((tagName) => (
            <Badge key={tagName} variant="secondary">
              {tagName}
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}

export { BadgeCloud };
