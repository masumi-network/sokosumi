import { Container, Section, Text } from "react-email";

import { EmailShell } from "../components/email-shell.js";
import {
  DARK_CLASS,
  LIGHT_PALETTE,
  MONO_STACK,
  RADIUS,
  SPACE,
  TEXT,
} from "../theme/index.js";

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

/** The catalogues end each label with a colon; the label style carries it. */
function withoutTrailingColon(label: string): string {
  return label.replace(/[:\uff1a]\s*$/, "");
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
      <Text
        className={DARK_CLASS.text}
        style={{
          ...TEXT.body,
          color: LIGHT_PALETTE.textPrimary,
          margin: `0 0 ${SPACE.lg} 0`,
        }}
      >
        {description}
      </Text>
      <Section
        className={DARK_CLASS.panel}
        style={{
          backgroundColor: LIGHT_PALETTE.surfaceSubtle,
          border: `1px solid ${LIGHT_PALETTE.hairline}`,
          borderRadius: RADIUS.panel,
          padding: `${SPACE.xs} ${SPACE.md}`,
        }}
      >
        {fields.map((field, index) => (
          <Section
            className={DARK_CLASS.rule}
            key={field.label}
            style={{
              borderTop:
                index === 0 ? "none" : `1px solid ${LIGHT_PALETTE.hairline}`,
              padding: `${SPACE.md} 0`,
            }}
          >
            <Text
              className={DARK_CLASS.textMuted}
              style={{
                ...TEXT.label,
                color: LIGHT_PALETTE.textMuted,
                margin: `0 0 ${SPACE.xs} 0`,
              }}
            >
              {withoutTrailingColon(field.label)}
            </Text>
            {field.codeBlock ? (
              <Container
                className={DARK_CLASS.code}
                style={{
                  backgroundColor: LIGHT_PALETTE.codeSurface,
                  border: `1px solid ${LIGHT_PALETTE.hairline}`,
                  borderRadius: RADIUS.control,
                  margin: 0,
                  padding: `${SPACE.sm} ${SPACE.md}`,
                }}
              >
                <Text
                  className={DARK_CLASS.text}
                  style={{
                    ...TEXT.small,
                    color: LIGHT_PALETTE.textPrimary,
                    fontFamily: MONO_STACK,
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {field.value}
                </Text>
              </Container>
            ) : (
              <Text
                className={DARK_CLASS.text}
                style={{
                  ...TEXT.small,
                  color: LIGHT_PALETTE.textPrimary,
                  fontFamily: MONO_STACK,
                  margin: 0,
                  wordBreak:
                    field.wordBreak === "break-all" ? "break-all" : "normal",
                }}
              >
                {field.value}
              </Text>
            )}
          </Section>
        ))}
      </Section>
    </EmailShell>
  );
}
