import { render } from "@react-email/render";
import { Button, Container, Link, Section, Text } from "react-email";

import { EmailShell } from "../components/email-shell.js";
import {
  DARK_CLASS,
  LIGHT_PALETTE,
  RADIUS,
  SPACE,
  TEXT,
} from "../theme/index.js";
import type { RenderedEmail } from "../types.js";

const DEFAULT_LINK_INSTRUCTIONS =
  "Or copy and paste this URL into your browser:";

export interface ActionEmailFact {
  label: string;
  value: string;
}

export interface ActionEmailTemplateProps {
  actionLabel: string;
  actionUrl: string;
  body: string;
  facts?: readonly ActionEmailFact[];
  footer: string;
  greeting: string;
  lang: string;
  linkInstructions?: string;
  preview: string;
  quote?: string;
  title: string;
}

export function ActionEmailTemplate({
  actionLabel,
  actionUrl,
  body,
  facts,
  footer,
  greeting,
  lang,
  linkInstructions = DEFAULT_LINK_INSTRUCTIONS,
  preview,
  quote,
  title,
}: ActionEmailTemplateProps) {
  return (
    <EmailShell footer={footer} lang={lang} preview={preview} title={title}>
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
      {quote ? (
        <Container
          className={DARK_CLASS.quote}
          style={{
            backgroundColor: LIGHT_PALETTE.surfaceSubtle,
            borderLeft: `3px solid ${LIGHT_PALETTE.quoteBar}`,
            borderRadius: `0 ${RADIUS.panel} ${RADIUS.panel} 0`,
            margin: `0 0 ${SPACE.lg} 0`,
            padding: `${SPACE.md}`,
          }}
        >
          <Text
            className={DARK_CLASS.text}
            style={{
              ...TEXT.small,
              color: LIGHT_PALETTE.textPrimary,
              fontStyle: "italic",
              margin: 0,
            }}
          >
            {quote}
          </Text>
        </Container>
      ) : null}
      {facts && facts.length > 0 ? (
        <Section style={{ margin: `0 0 ${SPACE.lg} 0` }}>
          {facts.map((fact) => (
            <Text
              className={DARK_CLASS.textMuted}
              key={fact.label}
              style={{
                ...TEXT.small,
                color: LIGHT_PALETTE.textMuted,
                margin: `0 0 ${SPACE.xs} 0`,
              }}
            >
              <span
                className={DARK_CLASS.text}
                style={{
                  color: LIGHT_PALETTE.textPrimary,
                  fontWeight: 600,
                }}
              >
                {fact.label}
              </span>
              {": "}
              {fact.value}
            </Text>
          ))}
        </Section>
      ) : null}
      <Section style={{ margin: `0 0 ${SPACE.lg} 0`, textAlign: "left" }}>
        <Button
          className={DARK_CLASS.solid}
          href={actionUrl}
          style={{
            ...TEXT.small,
            backgroundColor: LIGHT_PALETTE.accentSolid,
            borderRadius: RADIUS.control,
            color: LIGHT_PALETTE.accentForeground,
            display: "inline-block",
            fontWeight: 600,
            padding: `14px ${SPACE.lg}`,
            textDecoration: "none",
          }}
        >
          {actionLabel}
        </Button>
      </Section>
      <Container
        className={DARK_CLASS.panel}
        style={{
          backgroundColor: LIGHT_PALETTE.surfaceSubtle,
          border: `1px solid ${LIGHT_PALETTE.hairline}`,
          borderRadius: RADIUS.panel,
          margin: 0,
          padding: `${SPACE.md}`,
        }}
      >
        <Text
          className={DARK_CLASS.textMuted}
          style={{
            ...TEXT.micro,
            color: LIGHT_PALETTE.textMuted,
            margin: `0 0 ${SPACE.xs} 0`,
          }}
        >
          {linkInstructions}
        </Text>
        <Link
          className={DARK_CLASS.link}
          href={actionUrl}
          style={{
            ...TEXT.small,
            color: LIGHT_PALETTE.link,
            textDecoration: "none",
            wordBreak: "break-all",
          }}
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
