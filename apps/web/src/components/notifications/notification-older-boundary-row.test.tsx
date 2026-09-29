import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NotificationOlderBoundaryRow } from "./notification-older-boundary-row";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/use-load-when-visible", () => ({
  useLoadWhenVisible: vi.fn(),
}));

describe("NotificationOlderBoundaryRow", () => {
  function renderRow(status: "idle" | "loading" | "failed") {
    return render(
      <NotificationOlderBoundaryRow
        oldestId="oldest"
        status={status}
        onLoad={() => {}}
      />,
    );
  }

  // Idle is a button waiting to be pressed. Saying "Loading..." there tells
  // the reader older rows are on their way before anything asked for them,
  // and that is the state they keep for good when no observer runs.
  it("names the move while idle", () => {
    renderRow("idle");

    expect(screen.getByRole("button", { name: "showOlder" })).toBeTruthy();
    expect(screen.queryByText("loading")).toBeNull();
  });

  it("says it is loading only once it is", () => {
    const { container } = renderRow("loading");

    expect(screen.getByText("loading")).toBeTruthy();
    expect(screen.queryByText("showOlder")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });

  it("keeps a retry on the row when a page fails", () => {
    renderRow("failed");

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("fetchError")).toBeTruthy();
    expect(screen.getByText("retry")).toBeTruthy();
    expect(screen.queryByText("showOlder")).toBeNull();
  });
});
