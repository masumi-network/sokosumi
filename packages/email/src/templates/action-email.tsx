import { render } from "@react-email/render";
import { Button, Container, Link, Section, Text } from "react-email";

import { EmailShell } from "../components/email-shell.js";
import type { RenderedEmail } from "../types.js";

const DEFAULT_LINK_INSTRUCTIONS =
  "Or copy and paste this URL into your browser:";

export interface ActionEmailTemplateProps {
  actionLabel: string;
  actionUrl: string;
  body: string;
  footer: string;
  greeting: string;
  linkInstructions?: string;
  preview: string;
  title: string;
}

export function ActionEmailTemplate({
  actionLabel,
  actionUrl,
  body,
  footer,
  greeting,
  linkInstructions = DEFAULT_LINK_INSTRUCTIONS,
  preview,
  title,
}: ActionEmailTemplateProps) {
  return (
    <EmailShell footer={footer} preview={preview} title={title}>
      <Text className="m-0 mb-[14px] text-[16px] leading-[28px] text-[#17111f]">
        {greeting}
      </Text>
      <Text className="m-0 mb-[28px] text-[16px] leading-[28px] text-[#30263f]">
        {body}
      </Text>
      <Section className="mb-[28px] mt-0 text-left">
        <Button
          className="rounded-[12px] bg-[#6a36ff] px-[20px] py-[14px] text-[14px] font-semibold text-white no-underline"
          href={actionUrl}
        >
          {actionLabel}
        </Button>
      </Section>
      <Container className="mb-[24px] rounded-[16px] border border-solid border-[#ece6f7] bg-[#f8f5ff] px-[18px] py-[16px]">
        <Text className="m-0 mb-[8px] text-[13px] leading-[20px] font-medium text-[#4d4260]">
          {linkInstructions}
        </Text>
        <Link
          href={actionUrl}
          className="break-all text-[14px] leading-[24px] text-[#5f35d8] no-underline"
        >
          {actionUrl}
        </Link>
      </Container>
    </EmailShell>
  );
}

export interface RenderActionEmailProps extends ActionEmailTemplateProps {
  subject: string;
}

export async function renderActionEmail({
  subject,
  ...props
}: RenderActionEmailProps): Promise<RenderedEmail> {
  const html = await render(<ActionEmailTemplate {...props} />);

  return { html, subject };
}
