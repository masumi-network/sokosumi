import { Container, Section, Text } from "react-email";

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
      <Text className="m-0 mb-[24px] text-[16px] leading-[28px] text-[#30263f]">
        {description}
      </Text>
      {fields.map((field) => (
        <Section
          key={field.label}
          className="mb-[14px] rounded-[16px] border border-solid border-[#ece6f7] bg-[#fbfaff] px-[16px] py-[14px]"
        >
          <Text className="m-0 mb-[8px] text-[13px] leading-[18px] font-semibold tracking-[0.04em] text-[#6a36ff] uppercase">
            {field.label}
          </Text>
          {field.codeBlock ? (
            <Container className="rounded-[12px] border border-solid border-[#dfd7f2] bg-white p-[12px]">
              <Text className="m-0 whitespace-pre-wrap break-all font-mono text-[13px] leading-[20px] text-[#30263f]">
                {field.value}
              </Text>
            </Container>
          ) : (
            <Text
              className={
                field.wordBreak === "break-all"
                  ? "m-0 break-all font-mono text-[14px] leading-[22px] text-[#30263f]"
                  : "m-0 font-mono text-[14px] leading-[22px] text-[#30263f]"
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
