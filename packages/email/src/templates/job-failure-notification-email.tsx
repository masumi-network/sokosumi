import { Container } from "@react-email/container";
import { Section } from "@react-email/section";
import { Text } from "@react-email/text";

import { EmailShell } from "../components/email-shell.js";

export interface JobFailureField {
  codeBlock?: boolean;
  label: string;
  value: string;
  wordBreak?: "break-all" | "normal";
}

export interface JobFailureNotificationEmailTemplateProps {
  description: string;
  fields: JobFailureField[];
  footer: string;
  preview: string;
  title: string;
}

export function JobFailureNotificationEmailTemplate({
  description,
  fields,
  footer,
  preview,
  title,
}: JobFailureNotificationEmailTemplateProps) {
  return (
    <EmailShell footer={footer} maxWidth={600} preview={preview} title={title}>
      <Text className="m-0 mb-[16px] text-[14px] leading-[24px] text-black">
        {description}
      </Text>
      {fields.map((field) => (
        <Section key={field.label} className="my-[8px]">
          <Text className="my-[4px] text-[16px] font-semibold text-black">
            {field.label}
          </Text>
          {field.codeBlock ? (
            <Container className="rounded bg-[#f4f4f4] p-[8px]">
              <Text className="m-0 whitespace-pre-wrap break-all font-mono text-[14px] leading-[20px] text-[#333333]">
                {field.value}
              </Text>
            </Container>
          ) : (
            <Text
              className={
                field.wordBreak === "break-all"
                  ? "m-0 break-all font-mono text-[16px] text-[#666666]"
                  : "m-0 font-mono text-[16px] text-[#666666]"
              }
            >
              {field.value}
            </Text>
          )}
        </Section>
      ))}
    </EmailShell>
  );
}
