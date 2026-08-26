import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UserList } from "@/components/admin/users/user-list";
import type { AdminUserOverviewItem } from "@/lib/services/admin-user.service";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) => {
    if (key === "totalCount") {
      return `${values?.count} users`;
    }
    return key;
  },
  useFormatter: () => ({
    number: (value: number) => new Intl.NumberFormat("en-US").format(value),
    dateTime: () => "Aug 22, 2026",
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: 0,
  }),
}));

vi.mock("@/lib/actions/admin-users/action", () => ({
  listAdminUsersAction: vi.fn(),
}));

function createUser(
  overrides: Partial<AdminUserOverviewItem> = {},
): AdminUserOverviewItem {
  return {
    id: "user-1",
    name: "Kevin Harris",
    email: "homesafesa@gmail.com",
    createdAt: new Date("2026-08-22T00:00:00.000Z"),
    credits: 0,
    subscriptionPlan: "free",
    subscriptionStatus: "active",
    startedTaskCount: 1,
    ...overrides,
  };
}

describe("UserList credits", () => {
  it("shows truncated locale-grouped credits like the rest of the product", () => {
    render(
      <UserList
        initialPage={{
          users: [createUser({ credits: 2807.025 })],
          total: 1,
          nextCursor: null,
        }}
      />,
    );

    expect(screen.getByText("2,807")).toBeInTheDocument();
    expect(screen.queryByText("2,807.025")).not.toBeInTheDocument();
  });
});
