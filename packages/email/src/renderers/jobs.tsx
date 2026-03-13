import { render } from "@react-email/render";

import { createEmailTranslator } from "../i18n/translate.js";
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

type TranslateFn = ReturnType<typeof createEmailTranslator>["t"];

const JOB_STATUS_MESSAGE_KEYS = {
  completed: "jobs.finalStatus.status.completed",
  dispute_resolved: "jobs.finalStatus.status.dispute_resolved",
  failed: "jobs.finalStatus.status.failed",
  payment_failed: "jobs.finalStatus.status.payment_failed",
  refund_resolved: "jobs.finalStatus.status.refund_resolved",
} as const;

function formatGreeting(t: TranslateFn, name: string, key: string): string {
  const trimmedName = name.trim();

  if (trimmedName) {
    return t(key, { name: trimmedName });
  }

  return t(key, { name: "" }).trimEnd();
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

function resolveJobFinalStatusLabel(t: TranslateFn, jobStatus: string): string {
  const messageKey =
    JOB_STATUS_MESSAGE_KEYS[jobStatus as keyof typeof JOB_STATUS_MESSAGE_KEYS];

  return messageKey ? t(messageKey) : jobStatus;
}

interface RenderJobActionEmailOptions {
  actionLabel: string;
  actionUrl: string;
  body: string;
  footer: string;
  greeting: string;
  linkInstructions: string;
  preview: string;
  subject: string;
  title: string;
}

function renderJobActionEmail({
  actionLabel,
  actionUrl,
  body,
  footer,
  greeting,
  linkInstructions,
  preview,
  subject,
  title,
}: RenderJobActionEmailOptions): Promise<RenderedEmail> {
  return renderActionEmail({
    actionLabel,
    actionUrl,
    body,
    footer,
    greeting,
    linkInstructions,
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
  locale,
  recipientName,
}: JobFinalStatusEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);
  const resolvedStatus = resolveJobFinalStatusLabel(t, jobStatus);
  const resolvedJobName = jobName?.trim()
    ? jobName
    : t("jobs.finalStatus.fallbackJobName");

  return renderJobActionEmail({
    actionLabel: t("jobs.finalStatus.button"),
    actionUrl: jobLink,
    body: t("jobs.finalStatus.body", {
      agentName,
      jobName: resolvedJobName,
      status: resolvedStatus,
    }),
    footer: t("jobs.finalStatus.footer"),
    greeting: formatGreeting(t, recipientName, "jobs.finalStatus.greeting"),
    linkInstructions: t("jobs.finalStatus.linkInstructions"),
    preview: t("jobs.finalStatus.preview", {
      agentName,
      status: resolvedStatus,
    }),
    subject: t("jobs.finalStatus.subject", {
      agentName,
      status: resolvedStatus,
    }),
    title: t("jobs.finalStatus.title", { status: resolvedStatus }),
  });
}

export async function renderJobInputRequiredEmail({
  agentName,
  jobLink,
  jobName,
  locale,
  recipientName,
}: JobInputRequiredEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);
  const resolvedJobName = jobName?.trim();
  const body = resolvedJobName
    ? t("jobs.inputRequired.body", {
        agentName,
        jobName: resolvedJobName,
      })
    : t("jobs.inputRequired.bodyWithoutJobName", {
        agentName,
      });

  return renderJobActionEmail({
    actionLabel: t("jobs.inputRequired.button"),
    actionUrl: jobLink,
    body,
    footer: t("jobs.inputRequired.footer"),
    greeting: formatGreeting(t, recipientName, "jobs.inputRequired.greeting"),
    linkInstructions: t("jobs.inputRequired.linkInstructions"),
    preview: t("jobs.inputRequired.preview", { agentName }),
    subject: t("jobs.inputRequired.subject", { agentName }),
    title: t("jobs.inputRequired.title"),
  });
}

export async function renderJobFailureNotificationEmail({
  agentBlockchainIdentifier,
  agentId,
  agentName,
  agentStatus,
  jobBlockchainIdentifier,
  jobId,
  locale,
  network,
  onChainStatus,
  result,
  resultHash,
}: JobFailureNotificationEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);
  const fields: JobFailureField[] = [
    { label: t("jobs.failureNotification.network"), value: network },
    { label: t("jobs.failureNotification.agentName"), value: agentName },
    { label: t("jobs.failureNotification.agentId"), value: agentId },
    {
      label: t("jobs.failureNotification.agentBlockchainIdentifier"),
      value: agentBlockchainIdentifier,
      wordBreak: "break-all",
    },
    { label: t("jobs.failureNotification.jobId"), value: jobId },
    {
      label: t("jobs.failureNotification.jobBlockchainIdentifier"),
      value: jobBlockchainIdentifier ?? "null",
      wordBreak: "break-all",
    },
    {
      label: t("jobs.failureNotification.onChainStatus"),
      value: onChainStatus ?? "null",
    },
    {
      label: t("jobs.failureNotification.agentStatus"),
      value: agentStatus ?? "null",
    },
    {
      label: t("jobs.failureNotification.resultHash"),
      value: resultHash ?? "null",
      wordBreak: "break-all",
    },
    {
      codeBlock: true,
      label: t("jobs.failureNotification.output"),
      value: formatJsonValue(result),
    },
  ];
  const html = await render(
    <JobFailureNotificationEmailTemplate
      description={t("jobs.failureNotification.description")}
      fields={fields}
      footer={t("jobs.failureNotification.footer")}
      preview={t("jobs.failureNotification.preview", { jobId })}
      title={t("jobs.failureNotification.title")}
    />,
  );

  return {
    html,
    subject: t("jobs.failureNotification.subject", { jobId }),
  };
}
