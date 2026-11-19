import { z } from "@hono/zod-openapi";

const MAX_SECTIONS = 64;
const MAX_ITEMS = 128;
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 64;
const SECTION_NAME_PATTERN = /^[^\p{Cc}]+$/u;
export const MAX_SEEN_SIDEBAR_ITEMS = 512;

export const sidebarIdSchema = z
  .string()
  .max(MAX_ID_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const sidebarItemsSchema = z.array(sidebarIdSchema).max(MAX_ITEMS);
const sidebarSectionSchema = z.object({
  id: sidebarIdSchema,
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_NAME_LENGTH)
    .regex(SECTION_NAME_PATTERN)
    .nullable()
    .openapi({ pattern: SECTION_NAME_PATTERN.source }),
  items: sidebarItemsSchema,
});

const sidebarLayoutSchema = z
  .object({
    sections: z.array(sidebarSectionSchema).max(MAX_SECTIONS),
    hidden: sidebarItemsSchema,
  })
  .superRefine(({ sections, hidden }, ctx) => {
    if (new Set(sections.map(({ id }) => id)).size !== sections.length) {
      ctx.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Section IDs must be unique",
      });
    }
    const items = [...hidden, ...sections.flatMap((section) => section.items)];
    if (items.length > MAX_ITEMS || new Set(items).size !== items.length) {
      ctx.addIssue({
        code: "custom",
        message: `Use at most ${MAX_ITEMS} distinct items, each in one place`,
      });
    }
  })
  .openapi("SidebarLayout");

export const sidebarLayoutOrNullSchema = z.union([
  sidebarLayoutSchema,
  z.null(),
]);
