import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireGTMEvent } from "@/lib/gtm-events";

import SignUpFlow from "./sign-up-flow";

const socialButtonsMock = vi.fn();
const signUpFormMock = vi.fn();
const magicLinkMock = vi.fn();

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams as unknown as URLSearchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, values?: Record<string, string>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key;
    t.has = () => true;
    return t;
  },
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    viewRegisterArea: vi.fn(),
    registerFormStart: vi.fn(),
  },
}));

vi.mock("@/auth/components/social-buttons", () => ({
  __esModule: true,
  default: (props: unknown) => {
    socialButtonsMock(props);
    return <div data-testid="social-buttons" />;
  },
}));

vi.mock("./form", () => ({
  __esModule: true,
  default: (props: { onFormStart: () => void }) => {
    signUpFormMock(props);
    return (
      <button type="button" onClick={props.onFormStart}>
        type in details
      </button>
    );
  },
}));

vi.mock("./magic-link", () => ({
  SignUpMagicLink: (props: unknown) => {
    magicLinkMock(props);
    return <div data-testid="magic-link" />;
  },
}));

function emailField() {
  return screen.getByLabelText("Fields.Email.label");
}

async function continueWith(
  user: ReturnType<typeof userEvent.setup>,
  email: string,
) {
  await user.type(emailField(), email);
  await user.click(screen.getByRole("button", { name: "continueWithEmail" }));
}

describe("SignUpFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it("opens on the email step beside the providers, without Magic Link", () => {
    render(
      <SignUpFlow showMagicLink lastUsedMethod="google" returnUrl="/agents" />,
    );

    expect(emailField()).toHaveAttribute("autocomplete", "email");
    expect(emailField()).not.toHaveFocus();
    expect(socialButtonsMock).toHaveBeenCalledWith({
      returnUrl: "/agents",
      lastUsedMethod: "google",
    });
    expect(signUpFormMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("magic-link")).not.toBeInTheDocument();
  });

  it("stays on the email step while the address is invalid", async () => {
    const user = userEvent.setup();
    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);

    await continueWith(user, "not-an-email");

    expect(await screen.findByText("Email.invalid")).toBeVisible();
    expect(signUpFormMock).not.toHaveBeenCalled();
  });

  it("carries the confirmed email to the details step and the Magic Link", async () => {
    const user = userEvent.setup();
    render(
      <SignUpFlow showMagicLink lastUsedMethod={null} returnUrl="/agents" />,
    );

    await continueWith(user, "ada@example.com");

    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        returnUrl: "/agents",
      }),
    );
    expect(magicLinkMock).toHaveBeenLastCalledWith({
      email: "ada@example.com",
      returnUrl: "/agents",
    });
    expect(screen.getByText(/registeringAs:ada@example\.com/)).toBeVisible();
    expect(screen.queryByTestId("social-buttons")).not.toBeInTheDocument();
  });

  it("returns to the email step with the address kept and focused", async () => {
    const user = userEvent.setup();
    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);
    await continueWith(user, "ada@example.com");

    await user.click(screen.getByRole("button", { name: "changeEmail" }));

    expect(emailField()).toHaveValue("ada@example.com");
    expect(emailField()).toHaveFocus();
    expect(screen.getByTestId("social-buttons")).toBeInTheDocument();
  });

  it("locks an invitation's email on both steps", async () => {
    const user = userEvent.setup();
    render(
      <SignUpFlow
        showMagicLink
        lastUsedMethod={null}
        prefilledEmail="invited@example.com"
        invitationId="inv_1"
      />,
    );

    expect(emailField()).toBeDisabled();
    expect(emailField()).toHaveValue("invited@example.com");

    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));

    expect(signUpFormMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: "invited@example.com" }),
    );
    expect(
      screen.queryByRole("button", { name: "changeEmail" }),
    ).not.toBeInTheDocument();
  });

  it("counts the register view once and the form start once across steps", async () => {
    const user = userEvent.setup();
    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);
    expect(fireGTMEvent.viewRegisterArea).toHaveBeenCalledTimes(1);
    expect(fireGTMEvent.registerFormStart).not.toHaveBeenCalled();

    await continueWith(user, "ada@example.com");
    await user.click(screen.getByRole("button", { name: "type in details" }));

    expect(fireGTMEvent.viewRegisterArea).toHaveBeenCalledTimes(1);
    expect(fireGTMEvent.registerFormStart).toHaveBeenCalledTimes(1);
  });

  it("links to sign-in without a query when there is no OAuth request", () => {
    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);

    expect(screen.getByRole("link", { name: "Login.link" })).toHaveAttribute(
      "href",
      "/signin",
    );
  });

  it("carries the OAuth request on the sign-in link and into the details step", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: "https://consumer.example.com/callback",
      code_challenge: "test-challenge",
      exp: "1772367377",
      sig: "abc+def/ghi=",
    });

    render(
      <SignUpFlow
        lastUsedMethod={null}
        showMagicLink={false}
        clientName="CMO"
      />,
    );

    expect(screen.getByRole("link", { name: "Login.link" })).toHaveAttribute(
      "href",
      "/signin?client_id=test-client&redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback&code_challenge=test-challenge&exp=1772367377&sig=abc%2Bdef%2Fghi%3D",
    );
    expect(screen.getByText("descriptionFor:CMO")).toBeVisible();

    await continueWith(user, "ada@example.com");

    // A magic link opened in another browser cannot return to the product
    // that sent the person here, so the step offers none.
    expect(signUpFormMock).toHaveBeenCalled();
    expect(screen.queryByTestId("magic-link")).not.toBeInTheDocument();
  });

  it("shows what the page passes in under the methods of both steps", async () => {
    const user = userEvent.setup();
    render(
      <SignUpFlow showMagicLink lastUsedMethod={null}>
        <p>terms notice</p>
      </SignUpFlow>,
    );

    expect(screen.getByText("terms notice")).toBeVisible();

    await continueWith(user, "ada@example.com");

    expect(screen.getByText("terms notice")).toBeVisible();
  });

  it("keeps the returnUrl on the sign-in link", () => {
    mockSearchParams = new URLSearchParams({
      returnUrl: "/accept-invitation/invite_123",
    });

    render(<SignUpFlow showMagicLink lastUsedMethod={null} />);

    expect(screen.getByRole("link", { name: "Login.link" })).toHaveAttribute(
      "href",
      "/signin?returnUrl=%2Faccept-invitation%2Finvite_123",
    );
  });
});
