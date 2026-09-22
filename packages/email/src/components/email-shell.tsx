import type { ReactNode } from "react";
import {
  Body,
  Container,
  Head,
  Heading,
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
  footer: ReactNode;
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

/** The brand stripe down the leading edge of every email. */
const SPINE_WIDTH = 6;

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
            <table
              border={0}
              cellPadding="0"
              cellSpacing="0"
              role="presentation"
              width="100%"
            >
              <tbody>
                <tr>
                  <td
                    className={DARK_CLASS.spine}
                    style={{
                      backgroundColor: LIGHT_PALETTE.accent,
                      fontSize: 0,
                      lineHeight: 0,
                      width: `${SPINE_WIDTH}px`,
                    }}
                    width={SPINE_WIDTH}
                  >
                    &nbsp;
                  </td>
                  <td valign="top">
                    <Section
                      className="sk-pad"
                      style={{ padding: `${SPACE.lg} ${SPACE.lg} 0` }}
                    >
                      <img
                        alt="Sokosumi"
                        className={DARK_CLASS.logo}
                        height="15"
                        src={EMAIL_WORDMARK_URL}
                        style={{ border: 0, display: "block" }}
                        width="117"
                      />
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
                          margin: `0 0 ${SPACE.md} 0`,
                          padding: 0,
                          textAlign: "left",
                        }}
                      >
                        {title}
                      </Heading>
                      {children}
                    </Section>
                    <Section
                      className={`${DARK_CLASS.rule} sk-pad`}
                      style={{
                        borderTop: `1px solid ${LIGHT_PALETTE.hairline}`,
                        padding: `${SPACE.md} ${SPACE.lg} ${SPACE.lg}`,
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
                              <Text
                                className={DARK_CLASS.textMuted}
                                style={{
                                  ...TEXT.micro,
                                  color: LIGHT_PALETTE.textMuted,
                                  margin: 0,
                                  paddingRight: SPACE.md,
                                }}
                              >
                                {footer}
                              </Text>
                            </td>
                            <td align="right" valign="middle" width="14">
                              <img
                                alt=""
                                className={DARK_CLASS.logo}
                                height="28"
                                src={EMAIL_KANJI_URL}
                                style={{ border: 0, display: "block" }}
                                width="14"
                              />
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </Section>
                  </td>
                </tr>
              </tbody>
            </table>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}
