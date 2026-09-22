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
      {fields.map((field) => (
        <Section
          className={DARK_CLASS.panel}
          key={field.label}
          style={{
            backgroundColor: LIGHT_PALETTE.surfaceSubtle,
            border: `1px solid ${LIGHT_PALETTE.hairline}`,
            borderRadius: RADIUS.panel,
            margin: `0 0 ${SPACE.sm} 0`,
            padding: `${SPACE.md}`,
          }}
        >
          <Text
            className={DARK_CLASS.textMuted}
            style={{
              ...TEXT.label,
              color: LIGHT_PALETTE.textMuted,
              margin: `0 0 ${SPACE.sm} 0`,
            }}
          >
            {field.label}
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
    </EmailShell>
  );
}
