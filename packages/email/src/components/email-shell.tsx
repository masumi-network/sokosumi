import type { ReactNode } from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "react-email";

import {
  CARD_SHADOW,
  DARK_CLASS,
  darkModeCss,
  FONT_STACK,
  LIGHT_PALETTE,
  RADIUS,
  SPACE,
  TEXT,
} from "../theme/index.js";

export interface EmailShellProps {
  children: ReactNode;
  footer: string;
  /** Resolved email locale, announced to screen readers. */
  lang: string;
  maxWidth?: 560 | 600;
  preview: string;
  title: string;
}

const EMAIL_KANJI_URL =
  "https://igcd4cnfvuav1zto.public.blob.vercel-storage.com/brand/sokosumi-logo-kanji-black.png";
const EMAIL_WORDMARK_URL =
  "https://igcd4cnfvuav1zto.public.blob.vercel-storage.com/brand/sokosumi-logo-wordmark-black.png";

const RESPONSIVE_CSS = `@media only screen and (max-width: 600px) {
  .sk-pad { padding-left: ${SPACE.md} !important; padding-right: ${SPACE.md} !important; }
  .sk-heading { font-size: 24px !important; line-height: 32px !important; }
}`;

export function EmailShell({
  children,
  footer,
  lang,
  maxWidth = 560,
  preview,
  title,
}: EmailShellProps) {
  return (
    <Html lang={lang}>
      <Head>
        <meta content="text/html; charset=UTF-8" httpEquiv="Content-Type" />
        <meta content="light dark" name="color-scheme" />
        <meta content="light dark" name="supported-color-schemes" />
        <style
          dangerouslySetInnerHTML={{
            __html: `${darkModeCss()}\n${RESPONSIVE_CSS}`,
          }}
        />
      </Head>
      <Preview>{preview}</Preview>
      <Body
        className={DARK_CLASS.page}
        style={{
          backgroundColor: LIGHT_PALETTE.pageBackground,
          color: LIGHT_PALETTE.textPrimary,
          fontFamily: FONT_STACK,
          margin: 0,
          padding: 0,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <Section
          className={DARK_CLASS.page}
          style={{
            backgroundColor: LIGHT_PALETTE.pageBackground,
            padding: `${SPACE.xl} ${SPACE.md}`,
          }}
        >
          <Container
            className={DARK_CLASS.card}
            style={{
              backgroundColor: LIGHT_PALETTE.surface,
              border: `1px solid ${LIGHT_PALETTE.cardBorder}`,
              borderRadius: RADIUS.card,
              boxShadow: CARD_SHADOW,
              margin: "0 auto",
              maxWidth: `${maxWidth}px`,
              overflow: "hidden",
              width: "100%",
            }}
          >
            <Section
              className={`${DARK_CLASS.rule} sk-pad`}
              style={{
                borderBottom: `1px solid ${LIGHT_PALETTE.hairline}`,
                padding: `${SPACE.lg} ${SPACE.lg} ${SPACE.md}`,
              }}
            >
              <table
                border={0}
                cellPadding="0"
                cellSpacing="0"
                role="presentation"
                width="100%"
              >
                <tbody>
                  <tr>
                    <td valign="middle">
                      <img
                        alt="Sokosumi"
                        className={DARK_CLASS.logo}
                        height="20"
                        src={EMAIL_WORDMARK_URL}
                        style={{ display: "block", border: 0 }}
                        width="156"
                      />
                    </td>
                    <td align="right" valign="middle">
                      <img
                        alt=""
                        className={DARK_CLASS.logo}
                        height="28"
                        src={EMAIL_KANJI_URL}
                        style={{ display: "block", border: 0 }}
                        width="14"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>
            <Section
              className="sk-pad"
              style={{ padding: `${SPACE.xl} ${SPACE.lg}` }}
            >
              <Heading
                className={`${DARK_CLASS.heading} sk-heading`}
                style={{
                  ...TEXT.heading,
                  color: LIGHT_PALETTE.textPrimary,
                  margin: `0 0 ${SPACE.sm} 0`,
                  padding: 0,
                  textAlign: "left",
                }}
              >
                {title}
              </Heading>
              <Hr
                style={{
                  border: 0,
                  borderTop: `3px solid ${LIGHT_PALETTE.accent}`,
                  margin: `0 0 ${SPACE.lg} 0`,
                  width: "56px",
                }}
              />
              {children}
            </Section>
            <Section
              className={`${DARK_CLASS.rule} sk-pad`}
              style={{
                borderTop: `1px solid ${LIGHT_PALETTE.hairline}`,
                padding: `${SPACE.md} ${SPACE.lg} ${SPACE.lg}`,
              }}
            >
              <Text
                className={DARK_CLASS.textMuted}
                style={{
                  ...TEXT.micro,
                  color: LIGHT_PALETTE.textMuted,
                  margin: 0,
                }}
              >
                {footer}
              </Text>
            </Section>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}
