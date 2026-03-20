import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AgentDetailLegal } from "@/components/agents/agent-detail/legal";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("AgentDetailLegal", () => {
  it("renders DPA with the other legal links when present", () => {
    render(
      <AgentDetailLegal
        legal={{
          terms: "https://example.com/terms",
          privacyPolicy: "https://example.com/privacy",
          dpa: "https://example.com/dpa.pdf",
          other: "https://example.com/legal",
        }}
      />,
    );

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      ["terms", "privacyPolicy", "dpa", "other"],
    );
  });

  it("hides the DPA link when no DPA is available", () => {
    render(
      <AgentDetailLegal
        legal={{
          terms: "https://example.com/terms",
          privacyPolicy: "https://example.com/privacy",
          dpa: null,
          other: "https://example.com/legal",
        }}
      />,
    );

    expect(screen.queryByText("dpa")).not.toBeInTheDocument();
  });
});
