import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  render,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { getTranslations } from "next-intl/server";

export interface JobFailureNotificationEmailProps {
  network: string;
  agentId: string;
  agentBlockchainIdentifier: string;
  agentName: string;
  jobId: string;
  jobBlockchainIdentifier: string | null;
  onChainStatus: string | null;
  agentStatus: string | null;
  result: string | null;
  resultHash: string | null;
}

interface JobFailureNotificationEmailComponentProps
  extends JobFailureNotificationEmailProps {
  t: Awaited<ReturnType<typeof getTranslations>>;
}

export interface JobFailureNotificationEmail {
  subject: string;
  htmlBody: string;
}

const JobFailureNotificationEmailComponent = ({
  network,
  agentId,
  agentBlockchainIdentifier,
  agentName,
  jobId,
  jobBlockchainIdentifier,
  onChainStatus,
  agentStatus,
  result,
  resultHash,
  t,
}: JobFailureNotificationEmailComponentProps) => {
  // Helper function to format JSON strings
  const formatJson = (value: string | null) => {
    if (!value) return "null";
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  };

  return (
    <Html>
      <Head />
      <Preview>{t("preview", { jobId })}</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white px-2 font-sans">
          <Container className="mx-auto my-[40px] max-w-[600px] rounded border border-solid border-[#eaeaea] p-[20px]">
            <Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-black">
              {t("title")}
            </Heading>

            <Text className="text-[14px] leading-[24px] text-black">
              {t("description")}
            </Text>

            <Hr className="mx-0 my-4 w-full border border-solid border-[#eaeaea]" />

            <Section className="my-2">
              <Text className="my-1 text-base font-semibold text-black">
                {t("network")}
              </Text>
              <Text className="font-mono text-base text-[#666666]">
                {network}
              </Text>
            </Section>

            <Section className="my-2">
              <Text className="my-1 text-base font-semibold text-black">
                {t("agentName")}
              </Text>
              <Text className="font-mono text-base text-[#666666]">
                {agentName}
              </Text>
            </Section>

            <Section className="my-2">
              <Text className="my-1 text-base font-semibold text-black">
                {t("agentId")}
              </Text>
              <Text className="font-mono text-base text-[#666666]">
                {agentId}
              </Text>
            </Section>

            <Section className="my-2">
              <Text className="my-1 text-base font-semibold text-black">
                {t("agentBlockchainIdentifier")}
              </Text>
              <Text className="font-mono text-base break-all text-[#666666]">
                {agentBlockchainIdentifier}
              </Text>
            </Section>

            <Section className="my-2">
              <Text className="my-1 text-base font-semibold text-black">
                {t("jobId")}
              </Text>
              <Text className="font-mono text-base text-[#666666]">
                {jobId}
              </Text>
            </Section>

            <Section className="my-2">
              <Text className="my-1 text-base font-semibold text-black">
                {t("jobBlockchainIdentifier")}
              </Text>
              <Text className="font-mono text-base break-all text-[#666666]">
                {jobBlockchainIdentifier || "null"}
              </Text>
            </Section>

            <Section className="my-2">
              <Text className="my-1 text-base font-semibold text-black">
                {t("onChainStatus")}
              </Text>
              <Text className="font-mono text-base text-[#666666]">
                {onChainStatus || "null"}
              </Text>
            </Section>

            <Section className="my-2">
              <Text className="my-1 text-base font-semibold text-black">
                {t("agentStatus")}
              </Text>
              <Text className="font-mono text-base text-[#666666]">
                {agentStatus || "null"}
              </Text>
            </Section>

            <Section className="mb-[12px]">
              <Text className="my-1 text-base font-semibold text-black">
                {t("resultHash")}
              </Text>
              <Text className="font-mono text-base break-all text-[#666666]">
                {resultHash || "null"}
              </Text>
            </Section>

            <Section className="my-2">
              <Text className="my-1 text-base font-semibold text-black">
                {t("output")}
              </Text>
              <Container className="rounded bg-[#f4f4f4] p-2">
                <Text className="font-mono text-sm break-all whitespace-pre-wrap text-[#333333]">
                  {formatJson(result)}
                </Text>
              </Container>
            </Section>

            <Hr className="mx-0 my-4 w-full border border-solid border-[#eaeaea]" />

            <Text className="text-sm leading-[24px] text-[#666666]">
              {t("footer")}
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export async function reactJobFailureNotificationEmail(
  props: JobFailureNotificationEmailProps,
): Promise<JobFailureNotificationEmail> {
  const t = await getTranslations({
    locale: "en",
    namespace: "Library.Email.JobFailureNotification",
  });

  const htmlBody = await render(
    <JobFailureNotificationEmailComponent {...props} t={t} />,
  );

  return {
    subject: t("subject", { jobId: props.jobId }),
    htmlBody,
  };
}
