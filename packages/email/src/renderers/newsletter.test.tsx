import { describe, expect, it } from "vitest";

import {
  renderNewsletterConfirmationEmail,
  renderNewsletterConfirmPage,
  renderNewsletterEmail,
  renderNewsletterUnsubscribePage,
} from "./newsletter.js";

const UNSUBSCRIBE_URL =
  "https://example.com/v1/public/newsletter/unsubscribe?token=signed-token";

describe("newsletter rendering", () => {
  it.each([
    ["en", "Subscribe"],
    ["de", "Abonnieren"],
    ["es", "Suscribirse"],
  ])(
    "renders a public web footer in %s without email-only content or tracking",
    async (locale, label) => {
      const { html, text } = await renderNewsletterEmail({
        mode: "web",
        newsletter: {
          name: "Weekly <script>bad</script>",
          brand: { primaryColor: "#123456", footerText: "Thanks for reading" },
        },
        issue: {
          subject: "Public issue",
          previewText: "Inbox-only preview",
          template: "TEXT",
          content: [
            {
              type: "text",
              text: "**News** [read](https://example.com/read) <script>bad</script>",
            },
          ],
        },
        subscribeUrl: "https://example.com/n/weekly",
        locale,
      });
      expect(html).toContain(label);
      expect(html).toContain('href="https://example.com/n/weekly"');
      expect(html).toContain('href="https://example.com/read"');
      // The public page's sandboxed frame only allows links that open a new tab.
      for (const href of [
        "https://example.com/n/weekly",
        "https://example.com/read",
      ])
        expect(
          html.match(new RegExp(`<a[^>]*href="${href}"[^>]*>`))?.[0],
        ).toContain('target="_blank"');
      expect(html).toContain("<strong>News</strong>");
      expect(html).toContain("#123456");
      expect(html).toContain("Thanks for reading");
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("Inbox-only preview");
      expect(html).not.toContain("unsubscribe");
      expect(html).not.toContain("You received this email");
      expect(html).not.toContain("token=");
      expect(html).not.toContain("List-Unsubscribe");
      expect(html).not.toContain("<img");
      expect(text).toContain(label);
    },
  );

  it.each(["http://localhost:3000/n/weekly", "javascript:alert(1)"])(
    "validates web footer URLs: %s",
    async (subscribeUrl) => {
      const { html } = await renderNewsletterEmail({
        mode: "web",
        newsletter: { name: "Weekly", brand: {} },
        issue: { subject: "News", template: "TEXT", content: [] },
        subscribeUrl,
      });
      expect(html.includes(`href="${subscribeUrl}"`)).toBe(
        subscribeUrl.startsWith("http:"),
      );
    },
  );

  it("keeps the preview unsubscribe placeholder without allowing unsafe URLs", async () => {
    for (const unsubscribeUrl of ["#", "javascript:alert(1)"]) {
      const { html } = await renderNewsletterEmail({
        newsletter: { name: "Weekly", brand: {} },
        issue: { subject: "Preview", template: "TEXT", content: [] },
        unsubscribeUrl,
      });
      expect(html.includes('href="#"')).toBe(unsubscribeUrl === "#");
      expect(html).not.toContain('href="javascript:');
    }
  });
  it.each([
    ["en", "Confirm subscription", "Your subscription is confirmed", "7 days"],
    ["de", "Abonnement bestätigen", "Dein Abonnement ist bestätigt", "7 Tagen"],
    ["es", "Confirmar suscripción", "Tu suscripción está confirmada", "7 días"],
  ])(
    "renders localized opt-in email and POST confirmation page in %s",
    async (locale, title, confirmed, expiry) => {
      const confirmUrl =
        "https://example.com/v1/public/newsletter/confirm?token=signed-token";
      const email = await renderNewsletterConfirmationEmail({
        newsletter: {
          name: "Weekly <script>bad</script>",
          brand: { accentColor: "#123456" },
        },
        confirmUrl,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        locale,
      });
      expect(email.html).toContain(title);
      expect(email.html).toContain(
        'href="https://example.com/v1/public/newsletter/confirm?token=signed-token"',
      );
      expect(email.html).toContain("#123456");
      expect(email.html).not.toContain("<script>");
      expect(email.text).toContain(expiry);
      expect(email.text).toContain(confirmUrl);
      expect(email.text).toContain(UNSUBSCRIBE_URL);
      const page = await renderNewsletterConfirmPage({
        name: "Weekly <script>",
        actionUrl: "?token=signed-token",
        confirmed: false,
        locale,
      });
      expect(page).toContain(title);
      expect(page).toContain('method="post"');
      expect(page).toContain('action="?token=signed-token"');
      expect(page).not.toContain("<script>");
      const done = await renderNewsletterConfirmPage({
        name: "Weekly",
        actionUrl: "",
        confirmed: true,
        locale,
      });
      expect(done).toContain(confirmed);
      expect(done).not.toContain("<form");
    },
  );

  it("escapes user text, supports simple formatting, and includes a usable HTML and text footer", async () => {
    const email = await renderNewsletterEmail({
      newsletter: {
        name: "News <script>bad</script>",
        brand: {
          logoUrl: "https://example.com/logo.png",
          primaryColor: "#123456",
          accentColor: "#654321",
          fontFamily: "Georgia",
          footerText: '<img src=x onerror="bad">',
        },
      },
      issue: {
        subject: "Subject <script>bad</script>",
        previewText: "Preview <b>text</b>",
        template: "IMAGES",
        content: [
          { type: "heading", text: "Hello <script>bad</script>", level: 1 },
          { type: "heading", text: "Subheading", level: 2 },
          {
            type: "text",
            text: "**Bold <unsafe>** and [read](https://example.com/read)\n\nSecond paragraph <iframe> [bad](javascript:alert(1))",
          },
          {
            type: "image",
            url: "https://example.com/image.png",
            alt: '" <bad>',
            href: "https://example.com/image",
          },
          {
            type: "button",
            label: "Go <bad>",
            url: "https://example.com/button",
          },
          { type: "divider" },
        ],
      },
      unsubscribeUrl: UNSUBSCRIBE_URL,
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<iframe>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("<strong>Bold &lt;unsafe&gt;</strong>");
    expect(email.html).toContain('href="https://example.com/read"');
    expect(email.html).not.toContain('href="javascript:');
    expect(email.html).toContain("<table");
    expect(email.html).toContain("#123456");
    expect(email.html).toContain("Georgia");
    expect(email.html).toContain(UNSUBSCRIBE_URL);
    expect(email.html).toContain(
      "You received this email because you subscribed to",
    );
    expect(email.text).toContain(UNSUBSCRIBE_URL);
    expect(email.text).toContain("Second paragraph");
    expect(email.text).toContain("https://example.com/read");
  });

  it.each([
    ["en", "Unsubscribe", "Confirm unsubscribe", "You are unsubscribed"],
    ["de", "Abmelden", "Abmeldung bestätigen", "Du bist abgemeldet"],
    [
      "es",
      "Cancelar suscripción",
      "Confirmar cancelación de suscripción",
      "Tu suscripción se ha cancelado",
    ],
  ])(
    "localizes newsletter chrome in %s",
    async (locale, label, confirm, confirmed) => {
      const email = await renderNewsletterEmail({
        newsletter: { name: "Weekly", brand: {} },
        issue: { subject: "Hello", template: "TEXT", content: [] },
        unsubscribeUrl: UNSUBSCRIBE_URL,
        locale,
      });
      expect(email.html).toContain(label);
      expect(email.text).toContain(UNSUBSCRIBE_URL);
      const page = await renderNewsletterUnsubscribePage({
        name: "Weekly <script>",
        actionUrl: "?token=signed-token",
        confirmed: false,
        locale,
      });
      expect(page).toContain(confirm);
      expect(page).toContain('method="post"');
      expect(page).not.toContain("<script>");
      expect(
        await renderNewsletterUnsubscribePage({
          name: "Weekly",
          actionUrl: "",
          confirmed: true,
          locale,
        }),
      ).toContain(confirmed);
    },
  );
});
