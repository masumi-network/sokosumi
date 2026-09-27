import type { ReactNode } from "react";
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
}

export interface JobFailureNotificationEmailTemplateProps {
  description: string;
  /** Identifiers a support reply needs, kept out of the reader's way. */
  details: JobFailureField[];
  /** What failed and what it said, in reading order. */
  fields: JobFailureField[];
  footer: ReactNode;
  lang: string;
  preview: string;
  title: string;
}

/** The catalogues end each label with a colon; the label style carries it. */
function withoutTrailingColon(label: string): string {
  return label.replace(/[:：]\s*$/, "");
}

export function JobFailureNotificationEmailTemplate({
  description,
  details,
  fields,
  footer,
  lang,
  preview,
  title,
}: JobFailureNotificationEmailTemplateProps) {
  return (
    <EmailShell
      footer={footer}
      lang={lang}
      maxWidth={600}
      preview={preview}
      title={title}
    >
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
                className={DARK_CLASS.rule}
                style={{
                  borderLeft: `2px solid ${LIGHT_PALETTE.hairline}`,
                  margin: 0,
                  padding: `0 0 0 ${SPACE.md}`,
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
                }}
              >
                {field.value}
              </Text>
            )}
          </Section>
        ))}
      </Section>
      <Section style={{ padding: `${SPACE.lg} 0 0` }}>
        <table
          border={0}
          cellPadding="0"
          cellSpacing="0"
          role="presentation"
          width="100%"
        >
          <tbody>
            {details.map((detail) => (
              <tr key={detail.label}>
                <td
                  style={{ paddingBottom: SPACE.sm, width: "38%" }}
                  valign="top"
                >
                  <Text
                    className={DARK_CLASS.textMuted}
                    style={{
                      ...TEXT.micro,
                      color: LIGHT_PALETTE.textMuted,
                      margin: 0,
                      paddingRight: SPACE.md,
                    }}
                  >
                    {withoutTrailingColon(detail.label)}
                  </Text>
                </td>
                <td style={{ paddingBottom: SPACE.sm }} valign="top">
                  <Text
                    className={DARK_CLASS.textMuted}
                    style={{
                      ...TEXT.micro,
                      color: LIGHT_PALETTE.textMuted,
                      fontFamily: MONO_STACK,
                      margin: 0,
                      wordBreak: "break-all",
                    }}
                  >
                    {detail.value}
                  </Text>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </EmailShell>
  );
}
