import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import FlowsError from "./error";

function unauthenticated(): Error {
  const error = new Error("Unauthenticated");
  error.name = "UnAuthenticatedError";
  return error;
}

describe("(flows) error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a real logout to sign-in instead of showing a card", () => {
    // The card offers "try again" and a link home. Neither recovers a session
    // that is gone, so the boundary has to redirect the way `(app)` does.
    render(<FlowsError error={unauthenticated()} reset={vi.fn()} />);

    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining("/signin?returnUrl="),
    );
    expect(screen.queryByText("title")).toBeNull();
  });

  it("shows the card for any other failure", () => {
    render(<FlowsError error={new Error("Core is down")} reset={vi.fn()} />);

    expect(screen.getByText("title")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
