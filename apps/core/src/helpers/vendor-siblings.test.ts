import { TaskStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import {
  buildCoworkerSiblingTaskListFilter,
  isSameVendorSiblingTask,
} from "./vendor-siblings";

const { taskFindFirstMock, coworkerFindUniqueMock } = vi.hoisted(() => ({
  taskFindFirstMock: vi.fn(),
  coworkerFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      findFirst: taskFindFirstMock,
    },
    coworker: {
      findUnique: coworkerFindUniqueMock,
    },
  },
}));

describe("vendor-siblings", () => {
  beforeEach(() => {
    taskFindFirstMock.mockReset();
    coworkerFindUniqueMock.mockReset();
  });

  describe("isSameVendorSiblingTask", () => {
    const actor = {
      actor: "coworker" as const,
      coworkerId: "cow_a",
      vendorId: TEST_VENDOR_ID,
    };

    it("returns true for same-vendor assignee when actor is not assignee", () => {
      expect(
        isSameVendorSiblingTask(actor, {
          coworkerId: "cow_b",
          status: TaskStatus.READY,
          coworker: { vendorId: TEST_VENDOR_ID },
        }),
      ).toBe(true);
    });

    it("returns false when actor is assignee", () => {
      expect(
        isSameVendorSiblingTask(actor, {
          coworkerId: "cow_a",
          status: TaskStatus.READY,
          coworker: { vendorId: TEST_VENDOR_ID },
        }),
      ).toBe(false);
    });

    it("returns false for cross-vendor task", () => {
      expect(
        isSameVendorSiblingTask(actor, {
          coworkerId: "cow_b",
          status: TaskStatus.READY,
          coworker: { vendorId: "other_vendor" },
        }),
      ).toBe(false);
    });

    it("returns false for DRAFT tasks", () => {
      expect(
        isSameVendorSiblingTask(actor, {
          coworkerId: "cow_b",
          status: TaskStatus.DRAFT,
          coworker: { vendorId: TEST_VENDOR_ID },
        }),
      ).toBe(false);
    });
  });

  describe("buildCoworkerSiblingTaskListFilter", () => {
    it("includes assignee and same-vendor sibling tasks", () => {
      expect(
        buildCoworkerSiblingTaskListFilter({
          coworkerId: "cow_a",
          vendorId: TEST_VENDOR_ID,
        }),
      ).toEqual({
        OR: [
          { coworkerId: "cow_a" },
          {
            status: { not: TaskStatus.DRAFT },
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
