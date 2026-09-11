import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { CORE_AUTH_UNAVAILABLE_ERROR_DIGEST } from "@/lib/auth/errors";

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

  it("says the service is unavailable when Core could not be reached", () => {
    // Production leaves only the digest, so that is what the card reads. The
    // generic copy claims an unexpected error that someone was notified about,
    // which is wrong for a stall the user can simply wait out.
    const masked: Error & { digest?: string } = new Error(
      "An error occurred in the Server Components render.",
    );
    masked.digest = CORE_AUTH_UNAVAILABLE_ERROR_DIGEST;

    render(<FlowsError error={masked} reset={vi.fn()} />);

    expect(screen.getByText("unavailableTitle")).toBeInTheDocument();
    expect(screen.queryByText("title")).toBeNull();
  });
});
