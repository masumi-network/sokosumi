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

interface JobFailureNotificationEmailProps {
  jobId: string;
  onChainStatus: string | null;
  agentStatus: string | null;
  input: string;
  output: string | null;
  inputHash: string | null;
  resultHash: string | null;
  inputSchema: string;
}

export const JobFailureNotificationEmail = ({
  jobId,
  onChainStatus,
  agentStatus,
  input,
  output,
  inputHash,
  resultHash,
  inputSchema,
}: JobFailureNotificationEmailProps) => {
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
      <Preview>Job Failure Notification - {jobId}</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white px-2 font-sans">
          <Container className="mx-auto my-[40px] max-w-[600px] rounded border border-solid border-[#eaeaea] p-[20px]">
            <Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-black">
              Job Failure Notification
            </Heading>

            <Text className="text-[14px] leading-[24px] text-black">
              A job has failed. Here are the technical details:
            </Text>

            <Hr className="mx-0 my-[20px] w-full border border-solid border-[#eaeaea]" />

            <Section className="mb-[20px]">
              <Text className="mb-[8px] text-[12px] leading-[20px] font-semibold text-black">
                Job ID:
              </Text>
              <Text className="font-mono text-[12px] leading-[20px] text-[#666666]">
                {jobId}
              </Text>
            </Section>

            <Section className="mb-[20px]">
              <Text className="mb-[8px] text-[12px] leading-[20px] font-semibold text-black">
                On-Chain Status:
              </Text>
              <Text className="font-mono text-[12px] leading-[20px] text-[#666666]">
                {onChainStatus || "null"}
              </Text>
            </Section>

            <Section className="mb-[20px]">
              <Text className="mb-[8px] text-[12px] leading-[20px] font-semibold text-black">
                Agent Status:
              </Text>
              <Text className="font-mono text-[12px] leading-[20px] text-[#666666]">
                {agentStatus || "null"}
              </Text>
            </Section>

            <Section className="mb-[20px]">
              <Text className="mb-[8px] text-[12px] leading-[20px] font-semibold text-black">
                Input Hash:
              </Text>
              <Text className="font-mono text-[12px] leading-[20px] break-all text-[#666666]">
                {inputHash || "null"}
              </Text>
            </Section>

            <Section className="mb-[20px]">
              <Text className="mb-[8px] text-[12px] leading-[20px] font-semibold text-black">
                Result Hash:
              </Text>
              <Text className="font-mono text-[12px] leading-[20px] break-all text-[#666666]">
                {resultHash || "null"}
              </Text>
            </Section>

            <Section className="mb-[20px]">
              <Text className="mb-[8px] text-[12px] leading-[20px] font-semibold text-black">
                Input Schema:
              </Text>
              <Container className="rounded bg-[#f4f4f4] p-[12px]">
                <Text className="font-mono text-[11px] leading-[18px] break-all whitespace-pre-wrap text-[#333333]">
                  {formatJson(inputSchema)}
                </Text>
              </Container>
            </Section>

            <Section className="mb-[20px]">
              <Text className="mb-[8px] text-[12px] leading-[20px] font-semibold text-black">
                Input:
              </Text>
              <Container className="rounded bg-[#f4f4f4] p-[12px]">
                <Text className="font-mono text-[11px] leading-[18px] break-all whitespace-pre-wrap text-[#333333]">
                  {formatJson(input)}
                </Text>
              </Container>
            </Section>

            <Section className="mb-[20px]">
              <Text className="mb-[8px] text-[12px] leading-[20px] font-semibold text-black">
                Output:
              </Text>
              <Container className="rounded bg-[#f4f4f4] p-[12px]">
                <Text className="font-mono text-[11px] leading-[18px] break-all whitespace-pre-wrap text-[#333333]">
                  {formatJson(output)}
                </Text>
              </Container>
            </Section>

            <Hr className="mx-0 my-[26px] w-full border border-solid border-[#eaeaea]" />

            <Text className="text-[12px] leading-[24px] text-[#666666]">
              This is an automated notification from Sōkosumi.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export async function reactJobFailureNotificationEmail(
  props: JobFailureNotificationEmailProps,
) {
  return await render(<JobFailureNotificationEmail {...props} />);
}
