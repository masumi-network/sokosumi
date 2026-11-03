import { render, toPlainText } from "@react-email/render";
import type { NewsletterBlock, NewsletterBrand } from "@sokosumi/utils";
import type { ReactNode } from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "react-email";

import { createEmailTranslator } from "../i18n/translate.js";
import { FONT_STACK, LIGHT_PALETTE } from "../theme/index.js";

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

type NewsletterRenderProps =
  | (NewsletterEmailProps & { mode?: "email" })
  | (Omit<NewsletterEmailProps, "unsubscribeUrl"> & {
      mode: "web";
      subscribeUrl: string;
    });

function safeUrl(
  value: string | undefined,
  allowHttp = false,
): string | undefined {
  if (!value) return undefined;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || (allowHttp && protocol === "http:")
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function brandColor(value: string | undefined, fallback: string): string {
  return value && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)
    ? value
    : fallback;
}

/**
 * Bold or `[label](https://...)`. Brackets are excluded from label and URL and
 * lengths are bounded, so matching stays linear on untrusted public input.
 */
const INLINE_PATTERN =
  /\*\*([^*]+)\*\*|\[([^[\]\n]{1,500})\]\((https:\/\/[^\s)[\]]{1,2048})\)/g;

/** Parse only bold and HTTPS links. All other input stays escaped React text. */
function inlineText(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    result.push(text.slice(offset, match.index));
    if (match[1] !== undefined) {
      result.push(<strong key={match.index}>{match[1]}</strong>);
    } else if (safeUrl(match[3])) {
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

/** Content width inside the 600px card at the default 32px padding. */
const CONTENT_WIDTH = 536;

const SPACING = {
  compact: { padding: 20, gap: 0 },
  normal: { padding: 32, gap: 0 },
  roomy: { padding: 44, gap: 12 },
} as const;

const SPACER_HEIGHT = { sm: 16, md: 32, lg: 56 } as const;

const BUTTON_RADIUS = { square: 0, rounded: 4, pill: 999 } as const;

const IMAGE_MARGIN = {
  left: "0 auto 0 0",
  center: "0 auto",
  right: "0 0 0 auto",
} as const;

const SOCIAL_LABELS = {
  x: "X",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
} as const;

interface BlockStyle {
  accent: string;
  buttonText: string;
  buttonRadius: number;
  websiteLabel: string;
}

function paragraphs(text: string) {
  return text.split(/\r?\n\s*\r?\n/).map((paragraph, index) => (
    <Text
      key={`${index}:${paragraph}`}
      style={{ whiteSpace: "pre-line", lineHeight: "1.6" }}
    >
      {inlineText(paragraph)}
    </Text>
  ));
}

function renderBlock(block: NewsletterBlock, style: BlockStyle): ReactNode {
  switch (block.type) {
    case "heading":
      return (
        <Heading as={block.level === 1 ? "h1" : "h2"}>{block.text}</Heading>
      );
    case "text":
      return paragraphs(block.text);
    case "image": {
      const src = safeUrl(block.url);
      if (!src) return <Text>{block.alt}</Text>;
      const percent = block.width ?? 100;
      const image = (
        <Img
          src={src}
          alt={block.alt}
          width={String(Math.round((CONTENT_WIDTH * percent) / 100))}
          style={{
            width: `${percent}%`,
            maxWidth: CONTENT_WIDTH,
            height: "auto",
            margin: IMAGE_MARGIN[block.align ?? "center"],
          }}
        />
      );
      const href = safeUrl(block.href);
      return href ? <Link href={href}>{image}</Link> : image;
    }
    case "button": {
      const href = safeUrl(block.url);
      return href ? (
        <Section style={{ padding: "16px 0" }}>
          <Button
            href={href}
            style={{
              backgroundColor: style.accent,
              color: style.buttonText,
              padding: "12px 24px",
              borderRadius: style.buttonRadius,
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
    // shortcut: columns stay side by side on phones (no media query); stack them if readers complain.
    case "columns":
      return (
        <Row>
          {block.columns.map((column, index) => {
            const src = safeUrl(column.imageUrl);
            return (
              <Column
                key={`${index}:${column.text}`}
                style={{
                  width: `${Math.floor(100 / block.columns.length)}%`,
                  verticalAlign: "top",
                  paddingLeft: index ? 8 : 0,
                  paddingRight: index < block.columns.length - 1 ? 8 : 0,
                }}
              >
                {src ? (
                  <Img
                    src={src}
                    alt={column.alt ?? ""}
                    width={String(
                      Math.floor(CONTENT_WIDTH / block.columns.length) - 16,
                    )}
                    style={{ width: "100%", height: "auto" }}
                  />
                ) : null}
                {paragraphs(column.text)}
              </Column>
            );
          })}
        </Row>
      );
    case "spacer":
      return <Section style={{ height: SPACER_HEIGHT[block.size] }} />;
    case "social":
      return (
        <Text style={{ textAlign: "center" }}>
          {block.links.flatMap((link, index) => {
            const href = safeUrl(link.url);
            const label =
              link.network === "website"
                ? style.websiteLabel
                : SOCIAL_LABELS[link.network];
            const item = href ? (
              <Link key={`${index}:${link.url}`} href={href}>
                {label}
              </Link>
            ) : null;
            return index && item ? [" · ", item] : [item];
          })}
        </Text>
      );
    case "footer":
      return (
        <Text
          style={{
            whiteSpace: "pre-line",
            textAlign: "center",
            fontSize: 12,
            color: LIGHT_PALETTE.textMuted,
          }}
        >
          {inlineText(block.text)}
        </Text>
      );
  }
}

export async function renderNewsletterEmail(props: NewsletterRenderProps) {
  const { newsletter, issue, locale } = props;
  const { locale: lang, t } = createEmailTranslator(locale);
  const brand = newsletter.brand;
  const primary = brandColor(brand.primaryColor, LIGHT_PALETTE.textPrimary);
  const accent = brandColor(brand.accentColor, LIGHT_PALETTE.accentSolid);
  const fontFamily =
    brand.fontFamily && /^[\p{L}\p{N}\s,"'-]+$/u.test(brand.fontFamily)
      ? brand.fontFamily
      : FONT_STACK;
  const logoUrl = safeUrl(brand.logoUrl);
  const headerImageUrl = safeUrl(brand.headerImageUrl);
  const headerAlign = brand.headerAlign ?? "left";
  const spacing = SPACING[brand.spacing ?? "normal"];
  const blockStyle: BlockStyle = {
    accent,
    buttonText: brandColor(
      brand.buttonTextColor,
      LIGHT_PALETTE.accentForeground,
    ),
    buttonRadius: BUTTON_RADIUS[brand.buttonShape ?? "rounded"],
    websiteLabel: t("newsletter.website"),
  };
  const html = await render(
    <Html lang={lang}>
      <Head>
        <title>{issue.subject}</title>
      </Head>
      {props.mode !== "web" ? (
        <Preview>{issue.previewText ?? issue.subject}</Preview>
      ) : null}
      <Body
        style={{
          backgroundColor: brandColor(
            brand.backgroundColor,
            LIGHT_PALETTE.pageBackground,
          ),
          fontFamily,
          color: primary,
          margin: 0,
        }}
      >
        <Container
          style={{
            maxWidth: 600,
            backgroundColor: LIGHT_PALETTE.surface,
            padding: spacing.padding,
          }}
        >
          {headerImageUrl ? (
            <Img
              src={headerImageUrl}
              alt=""
              width={String(CONTENT_WIDTH)}
              style={{ width: "100%", height: "auto", marginBottom: 16 }}
            />
          ) : null}
          {logoUrl ? (
            <Img
              src={logoUrl}
              alt={newsletter.name}
              width="160"
              style={{ margin: IMAGE_MARGIN[headerAlign] }}
            />
          ) : null}
          {issue.content.map((block, index) => (
            <Section
              key={`${index}:${block.type}`}
              style={spacing.gap ? { paddingTop: spacing.gap } : undefined}
            >
              {renderBlock(block, blockStyle)}
            </Section>
          ))}
          <Hr style={{ borderColor: LIGHT_PALETTE.hairline }} />
          <Text>{newsletter.name}</Text>
          {props.mode !== "web" ? (
            <Text>{t("newsletter.why", { name: newsletter.name })}</Text>
          ) : null}
          {brand.footerText ? (
            <Text style={{ whiteSpace: "pre-line" }}>{brand.footerText}</Text>
          ) : null}
          {props.mode === "web" ? (
            <Link href={safeUrl(props.subscribeUrl, true)}>
              {t("newsletter.subscribe")}
            </Link>
          ) : (
            <Link
              href={
                props.unsubscribeUrl === "#"
                  ? "#"
                  : safeUrl(props.unsubscribeUrl)
              }
            >
              {t("newsletter.unsubscribe")}
            </Link>
          )}
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
