import { TaskLinkRelation, TaskStatus } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import type { VisibleTaskLink } from "./task-detail-api-types";
import { applyTaskLinkChanges } from "./task-detail-optimistic-links";

function link(id: string, relation: TaskLinkRelation): VisibleTaskLink {
  return { id, name: id, identifier: null, status: TaskStatus.READY, relation };
}

describe("applyTaskLinkChanges", () => {
  it("does not list a peer under a second relation: Core refuses that link", () => {
    const related = link("peer", TaskLinkRelation.RELATED);

    expect(
      applyTaskLinkChanges(
        [related],
        [{ add: link("peer", TaskLinkRelation.BLOCKS) }],
      ),
    ).toEqual([related]);
  });

  it("lists a peer again after its link was hidden", () => {
    const blocks = link("peer", TaskLinkRelation.BLOCKS);

    expect(
      applyTaskLinkChanges(
        [link("peer", TaskLinkRelation.RELATED)],
        [{ hidePeerTaskId: "peer" }, { add: blocks }],
      ),
    ).toEqual([blocks]);
  });
});
