import { z } from "@hono/zod-openapi";
import type { Agent } from "@sokosumi/database";

export const developerSchema = z
  .object({
    name: z.string().nullish().openapi({ example: "John Doe" }),
    image: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/image.png" }),
    organization: z.string().nullish().openapi({ example: "John Doe" }),
    email: z.email().nullish().openapi({ example: "john.doe@example.com" }),
    other: z
      .string()
      .nullish()
      .openapi({ example: "Other contact information" }),
  })
  .optional()
  .openapi("Developer");

export const getDeveloperFromAgent = (agent: Agent) => {
  const result = developerSchema.parse({
    name: agent.overrideAuthorName ?? agent.authorName ?? undefined,
    image: agent.overrideAuthorImage ?? agent.authorImage ?? undefined,
    organization:
      agent.overrideAuthorOrganization ?? agent.authorOrganization ?? undefined,
    email:
      agent.overrideAuthorContactEmail ?? agent.authorContactEmail ?? undefined,
    other:
      agent.overrideAuthorContactOther ?? agent.authorContactOther ?? undefined,
  });
  if (
    result &&
    result.name === undefined &&
    result.image === undefined &&
    result?.organization === undefined &&
    result?.email === undefined &&
    result?.other === undefined
  ) {
    return null;
  }
  return result;
};
