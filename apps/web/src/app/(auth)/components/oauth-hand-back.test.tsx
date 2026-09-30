import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OAuthHandBack from "./oauth-hand-back";

const mockContinue = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { client?: string }) =>
    values?.client ? `${key}:${values.client}` : key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    oauth2: {
      continue: (...args: unknown[]) => mockContinue(...args),
    },
  },
}));

const OAUTH_QUERY = "client_id=cmo&exp=1772367377&sig=signed";
const CMO = { name: "CMO", uri: "https://cmo.xyz", logoUri: undefined };

describe("OAuthHandBack", () => {
  beforeEach(() => {
    mockContinue.mockReset();
  });

  it("hands the request back to the provider exactly once", async () => {
    mockContinue.mockResolvedValue({
      data: {
        redirect: true,
        url: "https://app.cmo.xyz/api/auth/callback/sokosumi?code=abc",
      },
      error: null,
    });

    // StrictMode mounts twice; a second hand-back would issue a second code.
    render(
      <StrictMode>
        <OAuthHandBack oauthQuery={OAUTH_QUERY} client={CMO} />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(mockContinue).toHaveBeenCalledWith({
        created: true,
        oauth_query: OAUTH_QUERY,
      });
    });
    expect(mockContinue).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("continuingTo:CMO");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("stays on the page with an error when the provider refuses the request", async () => {
    mockContinue.mockResolvedValue({
      data: null,
      error: { status: 400, message: "invalid_signature" },
    });

    render(<OAuthHandBack oauthQuery={OAUTH_QUERY} client={CMO} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errorDescriptionFor:CMO",
    );
    // The request is dead; the way out is back to the product.
    expect(screen.getByRole("link", { name: "backTo:CMO" })).toHaveAttribute(
      "href",
      "https://cmo.xyz",
    );
  });

  it("stays on the page with an error when the provider cannot be reached", async () => {
    mockContinue.mockRejectedValue(new Error("network"));

    render(<OAuthHandBack oauthQuery={OAUTH_QUERY} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errorDescription",
    );
  });
});
