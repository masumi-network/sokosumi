import { Tag } from "@prisma/client";

import { Badge } from "./ui/badge";

export default function BadgeCloud({ tags }: { tags: Tag[] }) {
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
