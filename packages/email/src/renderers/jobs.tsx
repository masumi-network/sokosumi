import { render } from "@react-email/render";

import { createEmailTranslator } from "../i18n/translate.js";
import {
  type JobFailureField,
  JobFailureNotificationEmailTemplate,
} from "../templates/job-failure-notification-email.js";
import type {
  JobFailureNotificationEmailProps,
  RenderedEmail,
} from "../types.js";

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
  const { locale: lang, t } = createEmailTranslator(locale);
  // What failed and what it said. The identifiers a support reply needs sit
  // below, out of the reader's way.
  const fields: JobFailureField[] = [
    { label: t("jobs.failureNotification.agentName"), value: agentName },
    {
      codeBlock: true,
      label: t("jobs.failureNotification.output"),
      value: formatJsonValue(result),
    },
  ];
  const details: JobFailureField[] = [
    { label: t("jobs.failureNotification.network"), value: network },
    { label: t("jobs.failureNotification.jobId"), value: jobId },
    { label: t("jobs.failureNotification.agentId"), value: agentId },
    {
      label: t("jobs.failureNotification.onChainStatus"),
      value: onChainStatus ?? "null",
    },
    {
      label: t("jobs.failureNotification.agentStatus"),
      value: agentStatus ?? "null",
    },
    {
      label: t("jobs.failureNotification.jobBlockchainIdentifier"),
      value: jobBlockchainIdentifier ?? "null",
    },
    {
      label: t("jobs.failureNotification.agentBlockchainIdentifier"),
      value: agentBlockchainIdentifier,
    },
    {
      label: t("jobs.failureNotification.resultHash"),
      value: resultHash ?? "null",
    },
  ];
  const html = await render(
    <JobFailureNotificationEmailTemplate
      lang={lang}
      description={t("jobs.failureNotification.description")}
      details={details}
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
