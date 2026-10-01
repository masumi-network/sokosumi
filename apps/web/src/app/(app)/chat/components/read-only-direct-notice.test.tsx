import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    key === "readOnlyDirectNotice"
      ? `${values?.members} left. You can still read past messages, but you can't send new ones.`
      : key,
}));

import { ReadOnlyDirectNotice } from "./read-only-direct-notice";

describe("ReadOnlyDirectNotice", () => {
  it("says who left and that the history stays readable", () => {
    render(<ReadOnlyDirectNotice members="Sarthi" />);

    expect(
      screen.getByText(
        "Sarthi left. You can still read past messages, but you can't send new ones.",
      ),
    ).toBeInTheDocument();
  });
});
