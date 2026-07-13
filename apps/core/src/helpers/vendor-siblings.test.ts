import { TaskStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import {
  buildCoworkerAuthorizedTaskWhere,
  buildCoworkerSiblingTaskListFilter,
} from "./vendor-siblings";

describe("vendor-siblings", () => {
  describe("buildCoworkerSiblingTaskListFilter", () => {
    it("includes assignee and same-vendor sibling tasks", () => {
      expect(
        buildCoworkerSiblingTaskListFilter({
          coworkerId: "cow_a",
          vendorId: TEST_VENDOR_ID,
        }),
      ).toEqual({
        status: { not: TaskStatus.DRAFT },
        OR: [
          { coworkerId: "cow_a" },
          {
            coworkerId: { not: "cow_a" },
            coworker: {
              vendorId: TEST_VENDOR_ID,
            },
          },
        ],
      });
    });
  });

  describe("buildCoworkerAuthorizedTaskWhere", () => {
    it("scopes a single task with optional workspace and sibling filter", () => {
      expect(
        buildCoworkerAuthorizedTaskWhere({
          taskId: "tsk_1",
          coworkerId: "cow_a",
          vendorId: TEST_VENDOR_ID,
          workspaceId: "ws_1",
        }),
      ).toEqual({
        id: "tsk_1",
        archivedAt: null,
        workspaceId: "ws_1",
        status: { not: TaskStatus.DRAFT },
        OR: [
          { coworkerId: "cow_a" },
          {
            coworkerId: { not: "cow_a" },
            coworker: {
              vendorId: TEST_VENDOR_ID,
            },
          },
        ],
      });
    });
  });
});
