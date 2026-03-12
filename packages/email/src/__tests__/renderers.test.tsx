import {
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
      name: "Andreas",
      verificationLink: "https://example.com/verify",
    });

    expect(rendered.subject).toBe("Sokosumi - Verify your email address");
    expect(rendered.html).toContain("Verify your email address");
    expect(rendered.html).toContain("Hello Andreas");
    expect(rendered.html).toContain("https://example.com/verify");
  });

  it("renders reset password emails in English", async () => {
    const rendered = await renderResetPasswordEmail({
      name: "Andreas",
      resetLink: "https://example.com/reset",
    });

    expect(rendered.subject).toBe("Sokosumi - Reset your password");
    expect(rendered.html).toContain("Hello Andreas");
    expect(rendered.html).toContain("Reset your password");
  });

  it("falls back to a generic auth greeting for blank names", async () => {
    const rendered = await renderVerificationEmail({
      name: "   ",
      verificationLink: "https://example.com/verify",
    });

    expect(rendered.html).toContain("Hello");
    expect(rendered.html).not.toContain("Hello   ");
  });

  it("renders magic-link emails with the optional token fallback", async () => {
    const withToken = await renderMagicLinkEmail({
      magicLink: "https://example.com/magic",
      name: "Andreas",
      token: "secret-token",
    });
    const withoutToken = await renderMagicLinkEmail({
      magicLink: "https://example.com/magic",
    });

    expect(withToken.subject).toBe("Sokosumi - Sign in to your account");
    expect(withToken.html).toContain("secret-token");
    expect(withToken.html).toContain(
      "If you need it, you can also use this one-time token:",
    );
    expect(withToken.html).toContain("Hello Andreas");
    expect(withoutToken.html).not.toContain("secret-token");
  });

  it("renders organization invitation emails with interpolation", async () => {
    const rendered = await renderOrganizationInvitationEmail({
      invitationLink: "https://example.com/invite",
      invitorUsername: "Chris",
      organizationName: "Sokosumi Org",
    });

    expect(rendered.subject).toBe("Sokosumi - Organization Invitation");
    expect(rendered.html).toContain("Join Chris on Sokosumi Org");
    expect(rendered.html).toContain("https://example.com/invite");
  });

  it("renders job final status emails with fallback job names", async () => {
    const rendered = await renderJobFinalStatusEmail({
      agentName: "Planner",
      jobLink: "https://example.com/job",
      jobStatus: "completed",
      recipientName: "Andreas",
    });

    expect(rendered.subject).toBe("Sokosumi - Planner job completed");
    expect(rendered.html).toContain("Your job");
    expect(rendered.html).toContain("Planner");
  });

  it("falls back to a generic job greeting for blank recipient names", async () => {
    const rendered = await renderJobFinalStatusEmail({
      agentName: "Planner",
      jobLink: "https://example.com/job",
      jobStatus: "completed",
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
