import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  render,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { SokosumiJobStatus } from "@sokosumi/database";
import { getTranslations } from "next-intl/server";

interface JobStatusEmailProps {
  recipientName: string;
  agentName: string;
  jobName?: string | null;
  jobStatus: SokosumiJobStatus;
  jobLink: string;
}

export const JobStatusEmail = async ({
  recipientName,
  agentName,
  jobName,
  jobStatus,
  jobLink,
}: JobStatusEmailProps) => {
  const t = await getTranslations({
    locale: "en",
    namespace: "Library.Email.JobStatus",
  });

  const statusLabel = t(`status.${jobStatus}`);
  const resolvedJobName = jobName?.trim()
    ? jobName
    : t("fallbackJobName", { agentName });

  return (
    <Html>
      <Head />
      <Preview>{t("preview", { agentName, status: statusLabel })}</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white px-2 font-sans">
          <Container className="mx-auto my-[40px] max-w-[465px] rounded border border-solid border-[#eaeaea] p-[20px]">
            <Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-black">
              {t("title", { status: statusLabel })}
            </Heading>
            <Text className="text-[14px] leading-[24px] text-black">
              {t("greeting", { name: recipientName })}
            </Text>
            <Text className="text-[14px] leading-[24px] text-black">
              {t("body", {
                jobName: resolvedJobName,
                agentName,
                status: statusLabel,
              })}
            </Text>
            <Section className="mt-[32px] mb-[32px] text-center">
              <Button
                className="rounded bg-[#000000] px-5 py-3 text-center text-[12px] font-semibold text-white no-underline"
                href={jobLink}
              >
                {t("button")}
              </Button>
            </Section>
            <Text className="text-[14px] leading-[24px] text-black">
              {t("linkInstructions")}{" "}
              <Link href={jobLink} className="text-blue-600 no-underline">
                {jobLink}
              </Link>
            </Text>
            <Hr className="mx-0 my-[26px] w-full border border-solid border-[#eaeaea]" />
            <Text className="text-[12px] leading-[24px] text-[#666666]">
              {t("footer")}
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export async function reactJobStatusEmail(props: JobStatusEmailProps) {
  return await render(<JobStatusEmail {...props} />);
}
