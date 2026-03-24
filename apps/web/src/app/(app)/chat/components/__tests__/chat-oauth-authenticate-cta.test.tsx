import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ChatOAuthAuthenticateCta } from "../chat-oauth-authenticate-cta";

describe("ChatOAuthAuthenticateCta", () => {
  it("renders an authenticate button with expected link behavior", () => {
    render(
      <ChatOAuthAuthenticateCta
        href="https://hannah.sumike.ai/oauth/sokosumi/start?source=responses&sokosumi_user_id=user_1"
        label="Authenticate"
      />,
    );

    const link = screen.getByRole("link", { name: "Authenticate" });
    expect(link).toHaveAttribute(
      "href",
      "https://hannah.sumike.ai/oauth/sokosumi/start?source=responses&sokosumi_user_id=user_1",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
