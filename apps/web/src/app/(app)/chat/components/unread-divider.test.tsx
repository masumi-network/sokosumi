import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UnreadDivider } from "./unread-divider";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const LABEL = "UnreadDivider.label";

function follows(element: Element, reference: Element): boolean {
  return Boolean(
    reference.compareDocumentPosition(element) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("UnreadDivider", () => {
  it("ends the line with New when no day changes at the message", () => {
    render(<UnreadDivider dayLabel={null} />);

    expect(
      follows(screen.getByText(LABEL), screen.getByRole("separator")),
    ).toBe(true);
  });

  it("puts the day label before the line and New after it", () => {
    render(<UnreadDivider dayLabel="Yesterday" />);
    const separator = screen.getByRole("separator");

    expect(follows(separator, screen.getByText("Yesterday"))).toBe(true);
    expect(follows(screen.getByText(LABEL), separator)).toBe(true);
  });
});
