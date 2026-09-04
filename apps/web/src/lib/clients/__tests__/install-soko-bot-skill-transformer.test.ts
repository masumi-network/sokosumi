import { describe, expect, it } from "vitest";

import { installMySokoBotSkillResponseTransformer } from "@/lib/clients/generated/core/transformers.gen";

const meta = { timestamp: "2026-09-02T09:21:35.000Z" };

describe("installMySokoBotSkillResponseTransformer", () => {
  it("keeps skill null when the source lists unnamed candidates", async () => {
    const result = await installMySokoBotSkillResponseTransformer({
      data: {
        skill: null,
        candidates: [
          { name: "skill-a", description: "A", path: "skills/a" },
          { name: "skill-b", description: "B", path: "skills/b" },
        ],
      },
      meta: { ...meta },
    });

    expect(result.data.skill).toBeNull();
    expect(result.data.candidates).toHaveLength(2);
    expect(result.meta.timestamp).toEqual(new Date(meta.timestamp));
  });

  it("converts a present skill createdAt to Date", async () => {
    const result = await installMySokoBotSkillResponseTransformer({
      data: {
        skill: {
          id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          slug: "example-skill",
          name: "Example skill",
          description: "Does a thing",
          sourceUrl: "https://github.com/acme/skills",
          sourceRef: "main",
          createdAt: "2026-09-02T09:21:35.000Z",
        },
        candidates: [],
      },
      meta: { ...meta },
    });

    expect(result.data.skill?.createdAt).toBeInstanceOf(Date);
  });
});
