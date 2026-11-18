import { CURATED_FILE_VOCABULARY } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import { toWorkspaceLabel } from "./workspace-label";

describe("Workspace tag color identity", () => {
  it("shares a topic color only with its active, unmodified seeded tag", () => {
    const design = CURATED_FILE_VOCABULARY.find(
      (label) => label.kind === "TAG" && label.displayName === "Design",
    )!;
    const row = {
      ...design,
      id: "design-tag",
      kind: "TAG" as const,
      color: "pink" as const,
      archivedAt: null,
      vocabularyVersion: 2,
      createdByUserId: null,
    };
    expect(toWorkspaceLabel(row)).toMatchObject({
      taskTopicId: "design",
      color: "pink",
    });
    for (const change of [
      { createdByUserId: "user" },
      { description: "Our user research process" },
      { archivedAt: new Date() },
      { kind: "CATEGORY" as const },
    ]) {
      expect(
        toWorkspaceLabel({ ...row, ...change }).taskTopicId,
      ).toBeUndefined();
    }
  });
});
