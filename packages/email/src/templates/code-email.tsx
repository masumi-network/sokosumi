import { render } from "@react-email/render";
import { Section, Text } from "react-email";

import { EmailShell } from "../components/email-shell.js";
import {
  DARK_CLASS,
  LIGHT_PALETTE,
  MONO_STACK,
  RADIUS,
  SPACE,
  TEXT,
} from "../theme/index.js";
import type { RenderedEmail } from "../types.js";

export interface CodeEmailTemplateProps {
  body: string;
  code: string;
  footer: string;
  greeting: string;
  lang: string;
  title: string;
}

/**
 * A one-time code to type back into Sokosumi. No link: the code goes into
 * the tab that asked for it, so a scanner that opens links cannot use it up.
 */
export function CodeEmailTemplate({
  body,
  code,
  footer,
  greeting,
  lang,
  title,
}: CodeEmailTemplateProps) {
  return (
    <EmailShell footer={footer} lang={lang} preview={body} title={title}>
      <Text
        className={DARK_CLASS.text}
        style={{
          ...TEXT.body,
          color: LIGHT_PALETTE.textPrimary,
          margin: `0 0 ${SPACE.sm} 0`,
        }}
      >
        {greeting}
      </Text>
      <Text
        className={DARK_CLASS.text}
        style={{
          ...TEXT.body,
          color: LIGHT_PALETTE.textPrimary,
          margin: `0 0 ${SPACE.lg} 0`,
        }}
      >
        {body}
      </Text>
      <Section
        className={DARK_CLASS.panel}
        style={{
          backgroundColor: LIGHT_PALETTE.surfaceSubtle,
          border: `1px solid ${LIGHT_PALETTE.hairline}`,
          borderRadius: RADIUS.panel,
          margin: 0,
          padding: `${SPACE.md} ${SPACE.lg}`,
          textAlign: "center",
        }}
      >
        <Text
          className={DARK_CLASS.text}
          style={{
            ...TEXT.heading,
            color: LIGHT_PALETTE.textPrimary,
            fontFamily: MONO_STACK,
            letterSpacing: "0.2em",
            margin: 0,
          }}
        >
          {code}
        </Text>
      </Section>
    </EmailShell>
  );
}

export interface RenderCodeEmailProps extends CodeEmailTemplateProps {
  subject: string;
}

export async function renderCodeEmail({
  subject,
  ...props
}: RenderCodeEmailProps): Promise<RenderedEmail> {
  const html = await render(<CodeEmailTemplate {...props} />);

  return { html, subject };
}
