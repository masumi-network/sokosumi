import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Favicon } from "@/components/ui/favicon";
import { stubPendingImageLoad } from "@/test/stub-pending-image-load";

describe("Favicon", () => {
  stubPendingImageLoad();
  it("advances through candidates and renders fallback when exhausted", () => {
    render(
      <Favicon
        alt="Acme"
        sources={["https://a.example/favicon.ico", "https://b.example/favicon.ico"]}
        fallback={<span data-testid="favicon-fallback">fallback</span>}
      />,
    );

    const firstAttempt = screen.getByRole("img", { name: "Acme" });
    expect(firstAttempt.getAttribute("src")).toBe("https://a.example/favicon.ico");

    fireEvent.error(firstAttempt);

    const secondAttempt = screen.getByRole("img", { name: "Acme" });
    expect(secondAttempt.getAttribute("src")).toBe("https://b.example/favicon.ico");

    fireEvent.error(secondAttempt);

    expect(screen.queryByRole("img", { name: "Acme" })).not.toBeInTheDocument();
    expect(screen.getByTestId("favicon-fallback")).toBeInTheDocument();
  });

  it("restarts from the first source when candidates change", () => {
    const { rerender } = render(
      <Favicon
        alt="Acme"
        sources={["https://a.example/favicon.ico"]}
        fallback={<span data-testid="favicon-fallback">fallback</span>}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Acme" }));
    expect(screen.getByTestId("favicon-fallback")).toBeInTheDocument();

    rerender(
      <Favicon
        alt="Acme"
        sources={["https://c.example/favicon.ico"]}
        fallback={<span data-testid="favicon-fallback">fallback</span>}
      />,
    );

    const nextAttempt = screen.getByRole("img", { name: "Acme" });
    expect(nextAttempt.getAttribute("src")).toBe("https://c.example/favicon.ico");
  });
});
