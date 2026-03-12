import { Button } from "@react-email/button";
import { Link } from "@react-email/link";
import { Section } from "@react-email/section";
import { Text } from "@react-email/text";
import type { ReactNode } from "react";

import { EmailShell } from "../components/email-shell.js";

export interface ActionEmailTemplateProps {
  actionLabel: string;
  actionUrl: string;
  body: string;
  extraContent?: ReactNode;
  footer: string;
  greeting: string;
  linkInstructions: string;
  preview: string;
  title: string;
}

export function ActionEmailTemplate({
  actionLabel,
  actionUrl,
  body,
  extraContent,
  footer,
  greeting,
  linkInstructions,
  preview,
  title,
}: ActionEmailTemplateProps) {
  return (
    <EmailShell footer={footer} preview={preview} title={title}>
      <Text className="m-0 mb-[16px] text-[14px] leading-[24px] text-black">
        {greeting}
      </Text>
      <Text className="m-0 mb-[32px] text-[14px] leading-[24px] text-black">
        {body}
      </Text>
      <Section className="my-[32px] text-center">
        <Button
          className="rounded bg-[#000000] px-[20px] py-[12px] text-[12px] font-semibold text-white no-underline"
          href={actionUrl}
        >
          {actionLabel}
        </Button>
      </Section>
      <Text className="m-0 mb-[26px] text-[14px] leading-[24px] text-black">
        {linkInstructions}{" "}
        <Link href={actionUrl} className="break-all text-[#2563eb] no-underline">
          {actionUrl}
        </Link>
      </Text>
      {extraContent}
    </EmailShell>
  );
}
