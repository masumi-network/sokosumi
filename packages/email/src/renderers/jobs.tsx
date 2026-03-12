import { render } from "@react-email/render";

import { renderActionEmail } from "../templates/action-email.js";
import {
  type JobFailureField,
  JobFailureNotificationEmailTemplate,
} from "../templates/job-failure-notification-email.js";
import type {
  JobFailureNotificationEmailProps,
  JobFinalStatusEmailProps,
  JobInputRequiredEmailProps,
  RenderedEmail,
} from "../types.js";

function formatHiGreeting(name: string): string {
  const trimmedName = name.trim();
  return trimmedName ? `Hi ${trimmedName}` : "Hi";
}

function formatJsonValue(value: null | string): string {
  if (!value) {
    return "null";
  }

  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

function resolveJobFinalStatusLabel(jobStatus: string): string {
  switch (jobStatus) {
    case "completed":
      return "completed";
    case "dispute_resolved":
      return "dispute resolved";
    case "failed":
      return "failed";
    case "payment_failed":
      return "payment failed";
    case "refund_resolved":
      return "refunded";
    default:
      return jobStatus;
  }
}

interface RenderJobActionEmailOptions {
  actionLabel: string;
  actionUrl: string;
  body: string;
  preview: string;
  recipientName: string;
  subject: string;
  title: string;
}

function renderJobActionEmail({
  actionLabel,
  actionUrl,
  body,
  preview,
  recipientName,
  subject,
  title,
}: RenderJobActionEmailOptions): Promise<RenderedEmail> {
  return renderActionEmail({
    actionLabel,
    actionUrl,
    body,
    footer:
      "You're receiving this email because job notifications are enabled for your account.",
    greeting: formatHiGreeting(recipientName),
    preview,
    subject,
    title,
  });
}

export async function renderJobFinalStatusEmail({
  agentName,
  jobLink,
  jobName,
  jobStatus,
  recipientName,
}: JobFinalStatusEmailProps): Promise<RenderedEmail> {
  const resolvedStatus = resolveJobFinalStatusLabel(jobStatus);
  const resolvedJobName = jobName?.trim() ? jobName : "Your job";
  const subject = `Sokosumi - ${agentName} job ${resolvedStatus}`;
  return renderJobActionEmail({
    actionLabel: "View job",
    actionUrl: jobLink,
    body: `${resolvedJobName} for ${agentName} is now ${resolvedStatus}.`,
    preview: `Your job for ${agentName} is now ${resolvedStatus}.`,
    recipientName,
    subject,
    title: `Job ${resolvedStatus}`,
  });
}

export async function renderJobInputRequiredEmail({
  agentName,
  jobLink,
  jobName,
  recipientName,
}: JobInputRequiredEmailProps): Promise<RenderedEmail> {
  const resolvedJobName = jobName?.trim();
  const subject = `Sokosumi - ${agentName} needs your input`;
  const body = resolvedJobName
    ? `Your job ${resolvedJobName} for ${agentName} is waiting for your input to continue.`
    : `Your job for ${agentName} is waiting for your input to continue.`;
  return renderJobActionEmail({
    actionLabel: "Provide input",
    actionUrl: jobLink,
    body,
    preview: `Your job for ${agentName} requires input to continue.`,
    recipientName,
    subject,
    title: "Action Required",
  });
}

export async function renderJobFailureNotificationEmail({
  agentBlockchainIdentifier,
  agentId,
  agentName,
  agentStatus,
  jobBlockchainIdentifier,
  jobId,
  network,
  onChainStatus,
  result,
  resultHash,
}: JobFailureNotificationEmailProps): Promise<RenderedEmail> {
  const fields: JobFailureField[] = [
    { label: "Network:", value: network },
    { label: "Agent Name:", value: agentName },
    { label: "Agent ID:", value: agentId },
    {
      label: "Agent Blockchain Identifier:",
      value: agentBlockchainIdentifier,
      wordBreak: "break-all",
    },
    { label: "Job ID:", value: jobId },
    {
      label: "Job Blockchain Identifier:",
      value: jobBlockchainIdentifier ?? "null",
      wordBreak: "break-all",
    },
    {
      label: "On-Chain Status:",
      value: onChainStatus ?? "null",
    },
    {
      label: "Agent Status:",
      value: agentStatus ?? "null",
    },
    {
      label: "Result Hash:",
      value: resultHash ?? "null",
      wordBreak: "break-all",
    },
    {
      codeBlock: true,
      label: "Output:",
      value: formatJsonValue(result),
    },
  ];
  const subject = `Job Failure Notification - ${jobId}`;
  const html = await render(
    <JobFailureNotificationEmailTemplate
      description="A job has failed. Here are the technical details:"
      fields={fields}
      footer="This is an automated notification from Sōkosumi."
      preview={`Job ${jobId} has failed`}
      title="Job Failure Notification"
    />,
  );

  return {
    html,
    subject,
  };
}
