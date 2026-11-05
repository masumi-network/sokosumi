import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    `${values?.count ?? ""} ${key}`.trim(),
}));

import { CatchUpLine } from "./catch-up-line";

describe("CatchUpLine", () => {
  it("names the buckets in order, leaves small talk out, and stops at four", () => {
    const { container } = render(
      <CatchUpLine
        buckets={[
          { bucket: "needsYou", count: 1 },
          { bucket: "decisionMade", count: 2 },
          { bucket: "chitChat", count: 9 },
          { bucket: "commitment", count: 1 },
          { bucket: "blocker", count: 1 },
          { bucket: "fyi", count: 6 },
        ]}
      />,
    );
    expect(container.textContent).toBe(
      "1 needsYou·2 decisionMade·1 commitment·1 blocker",
    );
  });

  it("renders nothing when only small talk is unread", () => {
    const { container } = render(
      <CatchUpLine buckets={[{ bucket: "chitChat", count: 3 }]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("makes each bucket a button when the reader can jump to it", () => {
    const onSelect = vi.fn();
    render(
      <CatchUpLine
        buckets={[
          { bucket: "needsYou", count: 1 },
          { bucket: "fyi", count: 6 },
        ]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "6 fyi" }));
    expect(onSelect).toHaveBeenCalledWith("fyi");
  });
});
