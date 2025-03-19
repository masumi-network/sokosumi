import { Tag } from "@prisma/client";

export interface TagDTO {
  readonly id: string;
  readonly name: string;
}

export function createTagDTO(tag: Tag): TagDTO {
  return {
    id: tag.id,
    name: tag.name,
  };
}

export function createTagDTOs(tags: Tag[]): TagDTO[] {
  return tags.map(createTagDTO);
}
