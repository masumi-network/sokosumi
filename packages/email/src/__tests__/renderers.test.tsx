import { describe, expect, it } from "vitest";

import {
  renderAccessRequestEmail,
  renderChatRoomInvitationEmail,
  renderJobFailureNotificationEmail,
  renderLowBalanceEmail,
  renderMagicLinkEmail,
  renderOrganizationInvitationEmail,
  renderResetPasswordEmail,
  renderVerificationEmail,
} from "../index.js";
import { DARK_PALETTE, LIGHT_PALETTE } from "../theme/index.js";

describe("email renderers", () => {
  it("renders verification emails with a subject and html body", async () => {
    const rendered = await renderVerificationEmail({
      locale: "en",
      name: "Andreas",
      verificationLink: "https://example.com/verify",
    });

    expect(rendered.subject).toBe("Sokosumi - Verify your email address");
    expect(rendered.html).toContain(
      'src="https://igcd4cnfvuav1zto.public.blob.vercel-storage.com/brand/sokosumi-logo-kanji-black.png"',
    );
    expect(rendered.html).toContain(
      'src="https://igcd4cnfvuav1zto.public.blob.vercel-storage.com/brand/sokosumi-logo-wordmark-black.png"',
    );
    expect(rendered.html).toContain('alt=""');
    expect(rendered.html).toContain('lang="en"');
    expect(rendered.html).toContain('alt="Sokosumi"');
    expect(rendered.html).toContain(
      `background-color:${LIGHT_PALETTE.pageBackground}`,
    );
    expect(rendered.html).toContain(
      `background-color: ${DARK_PALETTE.surface} !important`,
    );
    expect(rendered.html).toContain("Verify your email address");
    expect(rendered.html).toContain("Hello Andreas");
    expect(rendered.html).toContain("https://example.com/verify");
  });

  it("renders reset password emails with localized copy", async () => {
    const rendered = await renderResetPasswordEmail({
      locale: "de",
      name: "Andreas",
      resetLink: "https://example.com/reset",
    });

    expect(rendered.subject).toBe("Sokosumi - Passwort zurücksetzen");
    expect(rendered.html).toContain('lang="de"');
    expect(rendered.html).toContain("Hallo Andreas");
    expect(rendered.html).toContain("Dein Passwort zur\u00fccksetzen");
  });

  it("falls back to a generic auth greeting for blank names", async () => {
    const rendered = await renderVerificationEmail({
      locale: "en",
      name: "   ",
      verificationLink: "https://example.com/verify",
    });

    expect(rendered.html).toContain("Hello");
    expect(rendered.html).not.toContain("Hello   ");
  });

  it("renders magic-link emails without exposing a token fallback", async () => {
    const rendered = await renderMagicLinkEmail({
      locale: "en",
      magicLink: "https://example.com/magic",
      name: "Andreas",
    });

    expect(rendered.subject).toBe("Sokosumi - Sign in to your account");
    expect(rendered.html).toContain(
      `background-color:${LIGHT_PALETTE.accentSolid}`,
    );
    expect(rendered.html).toContain(`background-color:${LIGHT_PALETTE.accent}`);
    expect(rendered.html).toContain("Hello Andreas");
    expect(rendered.html).not.toContain("one-time token");
    expect(rendered.html).not.toContain("secret-token");
  });

  it("renders organization invitation emails with interpolation", async () => {
    const rendered = await renderOrganizationInvitationEmail({
      invitationLink: "https://example.com/invite",
      invitorUsername: "Chris",
      locale: "en",
      organizationName: "Sokosumi Org",
    });

    expect(rendered.subject).toBe("Sokosumi - Organization Invitation");
    expect(rendered.html).toContain("Join Chris on Sokosumi Org");
    expect(rendered.html).toContain("https://example.com/invite");
  });

  it("renders chat room invitation emails with interpolation", async () => {
    const rendered = await renderChatRoomInvitationEmail({
      channelName: "Client Room",
      invitationLink: "https://example.com/chat/invites/invite-1",
      invitorUsername: "Ada",
      locale: "en",
      organizationName: "Acme Corp",
    });

    expect(rendered.subject).toBe("Sokosumi - Channel Invitation");
    expect(rendered.html).toContain("Join Client Room on Acme Corp");
    expect(rendered.html).toContain("Ada invited you to join Client Room");
    expect(rendered.html).toContain(
      "https://example.com/chat/invites/invite-1",
    );
  });

  it("renders job failure notification emails with formatted output", async () => {
    const rendered = await renderJobFailureNotificationEmail({
      agentBlockchainIdentifier: "agent-blockchain-id",
      agentId: "agent-id",
      agentName: "Planner",
      agentStatus: "failed",
      jobBlockchainIdentifier: "job-blockchain-id",
      jobId: "job-id",
      locale: "en",
      network: "mainnet",
      onChainStatus: "withdrawn",
      result: JSON.stringify({ error: "failure" }),
      resultHash: "result-hash",
    });

    expect(rendered.subject).toBe("Job Failure Notification - job-id");
    expect(rendered.html).toContain("agent-blockchain-id");
    expect(rendered.html).toContain("&quot;error&quot;: &quot;failure&quot;");
    expect(rendered.html).toContain("result-hash");
  });

  it("renders a low-balance billing email with the remaining credits", async () => {
    const rendered = await renderLowBalanceEmail({
      actionUrl: "https://app.sokosumi.com/billing?tab=credits",
      credits: 12,
      locale: "en",
      recipientName: "Sandro",
    });

    expect(rendered.subject).toBe("Sokosumi - Your credits are running low");
    expect(rendered.html).toContain("Hi Sandro");
    expect(rendered.html).toContain("12");
    expect(rendered.html).toContain(
      "https://app.sokosumi.com/billing?tab=credits",
    );
  });

  it("links the notification settings from the footer", async () => {
    const rendered = await renderAccessRequestEmail({
      actionUrl: "https://example.com/requests",
      locale: "en",
      recipientName: "Andreas",
      request: "vendor",
      settingsUrl: "https://example.com/account/notifications",
    });

    expect(rendered.html).toContain(
      'href="https://example.com/account/notifications"',
    );
    expect(rendered.html).toContain(">your notification settings</a>.");
  });

  it("leaves the footer link out when no settings url is known", async () => {
    const rendered = await renderAccessRequestEmail({
      actionUrl: "https://example.com/requests",
      locale: "en",
      recipientName: "Andreas",
      request: "vendor",
    });

    expect(rendered.html).not.toContain("your notification settings</a>");
    expect(rendered.html).toContain("your notification settings.");
  });
});
