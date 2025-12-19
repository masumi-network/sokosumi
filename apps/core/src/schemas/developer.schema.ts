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
  .openapi("Developer");

export const getDeveloperFromAgent = (agent: Agent) => {
  return developerSchema.parse({
    name: agent.overrideAuthorName ?? agent.authorName ?? undefined,
    image: agent.overrideAuthorImage ?? agent.authorImage ?? undefined,
    organization:
      agent.overrideAuthorOrganization ?? agent.authorOrganization ?? undefined,
    email:
      agent.overrideAuthorContactEmail ?? agent.authorContactEmail ?? undefined,
    other:
      agent.overrideAuthorContactOther ?? agent.authorContactOther ?? undefined,
  });
};
