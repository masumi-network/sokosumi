import { TagDTO } from "@/lib/db/dto/TagDTO";

import { Badge } from "./ui/badge";

export default function BadgeCloud({ tags }: { tags: TagDTO[] }) {
  return (
    <>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag, index) => (
            <Badge key={index} variant="secondary">
              {tag.name}
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}
