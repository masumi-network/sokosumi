import type { Contact } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

import { ContactsList } from "./contacts-list";

const quiet = {
  id: "c-1",
  name: "Mira Sample",
  organization: null,
  role: null,
  location: null,
  kind: "PERSON",
  avatarUrl: null,
  followUpAt: null,
  lastContactAt: new Date(Date.now() - 90 * 86_400_000),
  replyState: null,
  awaitingReplySince: null,
  channels: [],
} as unknown as Contact;

function renderQuiet(locale: string, messages: typeof en) {
  const onFollowUp = vi.fn();
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ContactsList
        contacts={[quiet]}
        onOpen={() => {}}
        onFollowUp={onFollowUp}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => {}}
        footer="1 of 1"
      />
    </NextIntlClientProvider>,
  );
  return onFollowUp;
}

describe("Gone quiet row action", () => {
  it.each([
    ["en", en],
    ["de", de],
    ["es", es],
  ] as const)(
    "names the follow-up button with its visible words and the person (%s)",
    (locale, messages) => {
      renderQuiet(locale, messages);
      const quietMessages = messages.App.Contacts.quiet;
      const button = screen.getByRole("button", {
        name: new RegExp(quietMessages.followUp),
      });
      // Voice control users say what they see: each visible label (the short
      // one on phones, the long one from sm) is in the name, then the person.
      const name = button.textContent ?? "";
      expect(name).toContain(quietMessages.followUpShort);
      expect(name).toContain(quietMessages.followUp);
      expect(name).toContain("Mira Sample");
      expect(button).not.toHaveAttribute("aria-label");
    },
  );

  it("keeps keyboard focus in the row when the button gives way to the date", () => {
    const onFollowUp = renderQuiet("en", en);
    const button = screen.getByRole("button", { name: /Follow up next week/ });
    button.focus();
    fireEvent.click(button);
    expect(onFollowUp).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /^Mira Sample/ })).toHaveFocus();
  });
});
