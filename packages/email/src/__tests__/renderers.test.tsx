import { describe, expect, it } from "vitest";

import {
  renderChatRoomInvitationEmail,
  renderJobFailureNotificationEmail,
  renderJobFinalStatusEmail,
  renderJobInputRequiredEmail,
  renderMagicLinkEmail,
  renderOrganizationInvitationEmail,
  renderResetPasswordEmail,
  renderVerificationEmail,
} from "../index.js";

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
    expect(rendered.html).toContain('alt="Sokosumi kanji"');
    expect(rendered.html).toContain('alt="Sokosumi"');
    expect(rendered.html).toContain("background-color:rgb(245,243,250)");
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
    expect(rendered.html).toContain("background-color:rgb(106,54,255)");
    expect(rendered.html).toContain("background-color:rgb(248,245,255)");
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

  it("renders job final status emails with fallback job names in a localized locale", async () => {
    const rendered = await renderJobFinalStatusEmail({
      agentName: "Planner",
      jobLink: "https://example.com/job",
      jobStatus: "completed",
      locale: "es",
      recipientName: "Andreas",
    });

    expect(rendered.subject).toBe("Sokosumi - Job completado de Planner");
    expect(rendered.html).toContain("Tu job");
    expect(rendered.html).toContain("Planner");
  });

  it("falls back to a generic job greeting for blank recipient names", async () => {
    const rendered = await renderJobFinalStatusEmail({
      agentName: "Planner",
      jobLink: "https://example.com/job",
      jobStatus: "completed",
      locale: "en",
      recipientName: "   ",
    });

    expect(rendered.html).toContain("Hi");
    expect(rendered.html).not.toContain("Hi   ");
  });

  it("renders job input required emails", async () => {
    const rendered = await renderJobInputRequiredEmail({
      agentName: "Planner",
      jobLink: "https://example.com/job",
      jobName: "Quarterly review",
      locale: "en",
      recipientName: "Andreas",
    });

    expect(rendered.subject).toBe("Sokosumi - Planner needs your input");
    expect(rendered.html).toContain("Quarterly review");
    expect(rendered.html).toContain("Provide input");
  });

  it("renders job input required fallback copy without duplicating the fallback job name", async () => {
    const rendered = await renderJobInputRequiredEmail({
      agentName: "Planner",
      jobLink: "https://example.com/job",
      locale: "en",
      recipientName: "Andreas",
    });

    expect(rendered.html).toContain(
      "Your job for Planner is waiting for your input to continue.",
    );
    expect(rendered.html).not.toContain("Your job Your job");
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
});
