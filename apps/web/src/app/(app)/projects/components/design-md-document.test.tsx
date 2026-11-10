import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DesignMdDocument } from "./design-md-document";

const LABELS = {
  colors: "Colors",
  typography: "Typography",
  frontMatter: "Front matter",
};

describe("DesignMdDocument", () => {
  it("draws colours as swatches and type as samples above the guidance", () => {
    render(
      <DesignMdDocument
        labels={LABELS}
        markdown={
          "---\ncolors:\n  primary: '#2F7D4F'\n  link: '{colors.primary}'\ntypography:\n  display:\n    fontFamily: Inter\n    fontSize: 30px\n    fontWeight: '300'\nspacing:\n  md: 16px\n---\n## Voice\n\nPlain words.\n"
        }
      />,
    );

    const colors = screen.getByTestId("design-md-colors");
    expect(within(colors).getByText("primary")).toBeInTheDocument();
    const primary = within(colors).getByText("#2F7D4F").closest("li");
    expect(primary?.querySelector("[aria-hidden]")).toHaveStyle({
      backgroundColor: "#2f7d4f",
    });
    // A reference is shown as written, on an unpainted swatch.
    const link = within(colors).getByText("{colors.primary}").closest("li");
    expect(link?.querySelector("[aria-hidden]")).not.toHaveAttribute("style");

    const type = screen.getByTestId("design-md-typography");
    expect(within(type).getByText("display")).toBeInTheDocument();
    expect(within(type).getByText("Inter · 30px · 300")).toBeInTheDocument();
    expect(within(type).getByText("Aa")).toHaveStyle({
      fontFamily: "Inter",
      fontWeight: "300",
    });

    // Tokens the page does not draw stay readable, as written.
    expect(
      screen.getByTestId("design-md-front-matter").querySelector("pre"),
    ).toHaveTextContent("md: 16px");
    expect(screen.getByRole("heading", { name: "Voice" })).toBeInTheDocument();
    expect(screen.getByText("Plain words.")).toBeInTheDocument();
  });

  it("keeps unreadable front matter as written, with no empty token sections", () => {
    render(
      <DesignMdDocument
        labels={LABELS}
        markdown={"---\ncolors: [red\n  : ]\n---\nGuidance."}
      />,
    );

    expect(screen.queryByTestId("design-md-colors")).toBeNull();
    expect(screen.queryByTestId("design-md-typography")).toBeNull();
    expect(
      screen.getByTestId("design-md-front-matter").querySelector("pre"),
    ).toHaveTextContent("colors: [red");
    expect(screen.getByText("Guidance.")).toBeInTheDocument();
  });

  it("renders a file without front matter as Markdown", () => {
    render(<DesignMdDocument labels={LABELS} markdown={"# Brand\n\nCalm."} />);

    expect(screen.queryByTestId("design-md-front-matter")).toBeNull();
    expect(screen.getByText("Calm.")).toBeInTheDocument();
  });
});
