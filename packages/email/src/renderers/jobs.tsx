import { render } from "@react-email/render";

import { ActionEmailTemplate } from "../templates/action-email.js";
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

const JOB_FINAL_STATUS_EMAIL = {
  button: "View job",
  fallbackJobName: "Your job",
  footer:
    "You're receiving this email because job notifications are enabled for your account.",
  linkInstructions: "Or copy and paste this URL into your browser:",
  status: {
    completed: "completed",
    dispute_resolved: "dispute resolved",
    failed: "failed",
    payment_failed: "payment failed",
    refund_resolved: "refunded",
  },
} as const;

const JOB_INPUT_REQUIRED_EMAIL = {
  button: "Provide input",
  fallbackJobName: "Your job",
  footer:
    "You're receiving this email because job notifications are enabled for your account.",
  linkInstructions: "Or copy and paste this URL into your browser:",
  subjectSuffix: "needs your input",
  title: "Action Required",
} as const;

const JOB_FAILURE_NOTIFICATION_EMAIL = {
  agentBlockchainIdentifier: "Agent Blockchain Identifier:",
  agentId: "Agent ID:",
  agentName: "Agent Name:",
  agentStatus: "Agent Status:",
  description: "A job has failed. Here are the technical details:",
  footer: "This is an automated notification from Sōkosumi.",
  jobBlockchainIdentifier: "Job Blockchain Identifier:",
  jobId: "Job ID:",
  network: "Network:",
  onChainStatus: "On-Chain Status:",
  output: "Output:",
  resultHash: "Result Hash:",
  title: "Job Failure Notification",
} as const;

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

function resolveJobFinalStatusLabel(
  jobStatus: string,
): string {
  return JOB_FINAL_STATUS_EMAIL.status[
    jobStatus as keyof typeof JOB_FINAL_STATUS_EMAIL.status
  ] ?? jobStatus;
}

export async function renderJobFinalStatusEmail({
  agentName,
  jobLink,
  jobName,
  jobStatus,
  recipientName,
}: JobFinalStatusEmailProps): Promise<RenderedEmail> {
  const resolvedStatus = resolveJobFinalStatusLabel(jobStatus);
  const resolvedJobName = jobName?.trim()
    ? jobName
    : JOB_FINAL_STATUS_EMAIL.fallbackJobName;
  const subject = `Sokosumi - ${agentName} job ${resolvedStatus}`;
  const html = await render(
    <ActionEmailTemplate
      actionLabel={JOB_FINAL_STATUS_EMAIL.button}
      actionUrl={jobLink}
      body={`${resolvedJobName} for ${agentName} is now ${resolvedStatus}.`}
      footer={JOB_FINAL_STATUS_EMAIL.footer}
      greeting={formatHiGreeting(recipientName)}
      linkInstructions={JOB_FINAL_STATUS_EMAIL.linkInstructions}
      preview={`Your job for ${agentName} is now ${resolvedStatus}.`}
      title={`Job ${resolvedStatus}`}
    />,
  );

  return {
    html,
    subject,
  };
}

export async function renderJobInputRequiredEmail({
  agentName,
  jobLink,
  jobName,
  recipientName,
}: JobInputRequiredEmailProps): Promise<RenderedEmail> {
  const resolvedJobName = jobName?.trim();
  const subject = `Sokosumi - ${agentName} ${JOB_INPUT_REQUIRED_EMAIL.subjectSuffix}`;
  const body = resolvedJobName
    ? `Your job ${resolvedJobName} for ${agentName} is waiting for your input to continue.`
    : `${JOB_INPUT_REQUIRED_EMAIL.fallbackJobName} for ${agentName} is waiting for your input to continue.`;
  const html = await render(
    <ActionEmailTemplate
      actionLabel={JOB_INPUT_REQUIRED_EMAIL.button}
      actionUrl={jobLink}
      body={body}
      footer={JOB_INPUT_REQUIRED_EMAIL.footer}
      greeting={formatHiGreeting(recipientName)}
      linkInstructions={JOB_INPUT_REQUIRED_EMAIL.linkInstructions}
      preview={`Your job for ${agentName} requires input to continue.`}
      title={JOB_INPUT_REQUIRED_EMAIL.title}
    />,
  );

  return {
    html,
    subject,
  };
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
    { label: JOB_FAILURE_NOTIFICATION_EMAIL.network, value: network },
    { label: JOB_FAILURE_NOTIFICATION_EMAIL.agentName, value: agentName },
    { label: JOB_FAILURE_NOTIFICATION_EMAIL.agentId, value: agentId },
    {
      label: JOB_FAILURE_NOTIFICATION_EMAIL.agentBlockchainIdentifier,
      value: agentBlockchainIdentifier,
      wordBreak: "break-all",
    },
    { label: JOB_FAILURE_NOTIFICATION_EMAIL.jobId, value: jobId },
    {
      label: JOB_FAILURE_NOTIFICATION_EMAIL.jobBlockchainIdentifier,
      value: jobBlockchainIdentifier ?? "null",
      wordBreak: "break-all",
    },
    {
      label: JOB_FAILURE_NOTIFICATION_EMAIL.onChainStatus,
      value: onChainStatus ?? "null",
    },
    {
      label: JOB_FAILURE_NOTIFICATION_EMAIL.agentStatus,
      value: agentStatus ?? "null",
    },
    {
      label: JOB_FAILURE_NOTIFICATION_EMAIL.resultHash,
      value: resultHash ?? "null",
      wordBreak: "break-all",
    },
    {
      codeBlock: true,
      label: JOB_FAILURE_NOTIFICATION_EMAIL.output,
      value: formatJsonValue(result),
    },
  ];
  const subject = `Job Failure Notification - ${jobId}`;
  const html = await render(
    <JobFailureNotificationEmailTemplate
      description={JOB_FAILURE_NOTIFICATION_EMAIL.description}
      fields={fields}
      footer={JOB_FAILURE_NOTIFICATION_EMAIL.footer}
      preview={`Job ${jobId} has failed`}
      title={JOB_FAILURE_NOTIFICATION_EMAIL.title}
    />,
  );

  return {
    html,
    subject,
  };
}
