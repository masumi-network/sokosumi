import { render, toPlainText } from "@react-email/render";
import type { NewsletterBlock } from "@sokosumi/utils";
import type { ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";

import { createEmailTranslator } from "../i18n/translate.js";
import { FONT_STACK, LIGHT_PALETTE } from "../theme/index.js";

interface NewsletterBrand {
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  footerText?: string;
}

interface NewsletterEmailProps {
  newsletter: { name: string; brand: NewsletterBrand };
  issue: {
    subject: string;
    previewText?: string | null;
    template: "TEXT" | "IMAGES" | "BUTTONS";
    content: NewsletterBlock[];
  };
  unsubscribeUrl: string;
  locale?: string;
}

function httpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function brandColor(value: string | undefined, fallback: string): string {
  return value && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)
    ? value
    : fallback;
}

/** Parse only bold and HTTPS links. All other input stays escaped React text. */
function inlineText(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(
    /\*\*([^*]+)\*\*|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g,
  )) {
    result.push(text.slice(offset, match.index));
    if (match[1] !== undefined) {
      result.push(<strong key={match.index}>{match[1]}</strong>);
    } else if (httpsUrl(match[3])) {
      result.push(
        <Link key={match.index} href={match[3]}>
          {match[2]}
        </Link>,
      );
    } else {
      result.push(match[0]);
    }
    offset = match.index + match[0].length;
  }
  result.push(text.slice(offset));
  return result;
}

function renderBlock(block: NewsletterBlock, accent: string): ReactNode {
  switch (block.type) {
    case "heading":
      return (
        <Heading as={block.level === 1 ? "h1" : "h2"}>{block.text}</Heading>
      );
    case "text":
      return block.text.split(/\r?\n\s*\r?\n/).map((paragraph, index) => (
        <Text
          key={`${index}:${paragraph}`}
          style={{ whiteSpace: "pre-line", lineHeight: "1.6" }}
        >
          {inlineText(paragraph)}
        </Text>
      ));
    case "image": {
      const src = httpsUrl(block.url);
      if (!src) return <Text>{block.alt}</Text>;
      const image = (
        <Img
          src={src}
          alt={block.alt}
          width="536"
          style={{ width: "100%", maxWidth: 536, height: "auto" }}
        />
      );
      const href = httpsUrl(block.href);
      return href ? <Link href={href}>{image}</Link> : image;
    }
    case "button": {
      const href = httpsUrl(block.url);
      return href ? (
        <Section style={{ padding: "16px 0" }}>
          <Button
            href={href}
            style={{
              backgroundColor: accent,
              color: LIGHT_PALETTE.accentForeground,
              padding: "12px 24px",
              borderRadius: 4,
            }}
          >
            {block.label}
          </Button>
        </Section>
      ) : (
        <Text>{block.label}</Text>
      );
    }
    case "divider":
      return <Hr style={{ borderColor: LIGHT_PALETTE.hairline }} />;
  }
}

export async function renderNewsletterEmail({
  newsletter,
  issue,
  unsubscribeUrl,
  locale,
}: NewsletterEmailProps) {
  const { locale: lang, t } = createEmailTranslator(locale);
  const brand = newsletter.brand;
  const primary = brandColor(brand.primaryColor, LIGHT_PALETTE.textPrimary);
  const accent = brandColor(brand.accentColor, LIGHT_PALETTE.accentSolid);
  const fontFamily =
    brand.fontFamily && /^[\p{L}\p{N}\s,"'-]+$/u.test(brand.fontFamily)
      ? brand.fontFamily
      : FONT_STACK;
  const logoUrl = httpsUrl(brand.logoUrl);
  const html = await render(
    <Html lang={lang}>
      <Head>
        <title>{issue.subject}</title>
      </Head>
      <Preview>{issue.previewText ?? issue.subject}</Preview>
      <Body
        style={{
          backgroundColor: LIGHT_PALETTE.pageBackground,
          fontFamily,
          color: primary,
          margin: 0,
        }}
      >
        <Container
          style={{
            maxWidth: 600,
            backgroundColor: LIGHT_PALETTE.surface,
            padding: 32,
          }}
        >
          {logoUrl ? (
            <Img src={logoUrl} alt={newsletter.name} width="160" />
          ) : null}
          {issue.content.map((block, index) => (
            <Section key={`${index}:${block.type}`}>
              {renderBlock(block, accent)}
            </Section>
          ))}
          <Hr style={{ borderColor: LIGHT_PALETTE.hairline }} />
          <Text>{newsletter.name}</Text>
          <Text>{t("newsletter.why", { name: newsletter.name })}</Text>
          {brand.footerText ? (
            <Text style={{ whiteSpace: "pre-line" }}>{brand.footerText}</Text>
          ) : null}
          <Link href={httpsUrl(unsubscribeUrl)}>
            {t("newsletter.unsubscribe")}
          </Link>
        </Container>
      </Body>
    </Html>,
  );
  return { subject: issue.subject, html, text: toPlainText(html) };
}

export async function renderNewsletterUnsubscribePage(
  props: NewsletterActionPageProps,
) {
  return renderNewsletterActionPage({ ...props, action: "unsubscribe" });
}

interface NewsletterActionPageProps {
  name: string;
  actionUrl: string;
  confirmed: boolean;
  locale?: string;
}

export async function renderNewsletterConfirmPage(
  props: NewsletterActionPageProps,
) {
  return renderNewsletterActionPage({ ...props, action: "subscribe" });
}

async function renderNewsletterActionPage({
  name,
  actionUrl,
  confirmed,
  locale,
  action,
}: NewsletterActionPageProps & { action: "subscribe" | "unsubscribe" }) {
  const { locale: lang, t } = createEmailTranslator(locale);
  const title = t(
    action === "subscribe"
      ? confirmed
        ? "newsletter.confirmed"
        : "newsletter.confirmSubscription"
      : confirmed
        ? "newsletter.unsubscribed"
        : "newsletter.confirm",
  );
  return render(
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{title}</title>
      </head>
      <body
        style={{
          fontFamily: FONT_STACK,
          maxWidth: 480,
          padding: 32,
          margin: "32px auto",
        }}
      >
        <h1>{title}</h1>
        <p>{name}</p>
        {!confirmed ? (
          <form method="post" action={actionUrl}>
            <button type="submit">{title}</button>
          </form>
        ) : null}
      </body>
    </html>,
  );
}

export async function renderNewsletterConfirmationEmail({
  newsletter,
  confirmUrl,
  unsubscribeUrl,
  locale,
}: Pick<NewsletterEmailProps, "newsletter" | "unsubscribeUrl" | "locale"> & {
  confirmUrl: string;
}) {
  const { t } = createEmailTranslator(locale);
  return renderNewsletterEmail({
    newsletter,
    unsubscribeUrl,
    locale,
    issue: {
      subject: t("newsletter.confirmation.subject", { name: newsletter.name }),
      template: "BUTTONS",
      content: [
        {
          type: "heading",
          level: 1,
          text: t("newsletter.confirmSubscription"),
        },
        {
          type: "text",
          text: t("newsletter.confirmation.body", { name: newsletter.name }),
        },
        {
          type: "button",
          label: t("newsletter.confirmSubscription"),
          url: confirmUrl,
        },
        { type: "text", text: t("newsletter.confirmation.expiry") },
      ],
    },
  });
}
