import type { ChatRoom } from "@sokosumi/core-client";
import { render, renderHook, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import de from "@/../messages/de.json";
import en from "@/../messages/en.json";

import {
  ReadOnlyDirectNotice,
  useReadOnlyDirectNotice,
} from "./read-only-direct-notice";

function former(name: string) {
  return { id: name, name, email: `${name}@example.com`, image: null };
}

function direct(overrides: Partial<ChatRoom>): ChatRoom {
  return {
    isReadOnly: true,
    groupName: null,
    formerUserMembers: [],
    ...overrides,
  } as ChatRoom;
}

function noticeFor(room: ChatRoom, locale = "en") {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "de" ? de : en}
    >
      {children}
    </NextIntlClientProvider>
  );
  return renderHook(() => useReadOnlyDirectNotice(room), { wrapper }).result
    .current;
}

describe("useReadOnlyDirectNotice", () => {
  it("names who left", () => {
    expect(noticeFor(direct({ formerUserMembers: [former("Sarthi")] }))).toBe(
      "Sarthi left. You can still read past messages, but you can't send new ones.",
    );
  });

  it("names the people who left, not a group's Group name", () => {
    expect(
      noticeFor(
        direct({
          groupName: "Launch team",
          formerUserMembers: [former("Ben"), former("Cara")],
        }),
      ),
    ).toBe(
      "Ben, Cara left. You can still read past messages, but you can't send new ones.",
    );
  });

  it("agrees the verb with how many left", () => {
    expect(
      noticeFor(direct({ formerUserMembers: [former("Sarthi")] }), "de"),
    ).toMatch(/^Sarthi hat den Chat verlassen\./);
    expect(
      noticeFor(
        direct({ formerUserMembers: [former("Ben"), former("Cara")] }),
        "de",
      ),
    ).toMatch(/^Ben, Cara haben den Chat verlassen\./);
  });

  it("still explains itself when no former profile is left", () => {
    expect(noticeFor(direct({}))).toBe(
      "Everyone else left. You can still read past messages, but you can't send new ones.",
    );
  });

  it("says nothing while the room takes messages", () => {
    expect(
      noticeFor(
        direct({ isReadOnly: false, formerUserMembers: [former("Ben")] }),
      ),
    ).toBeNull();
  });
});

describe("ReadOnlyDirectNotice", () => {
  it("shows the message in place of the composer", () => {
    render(<ReadOnlyDirectNotice message="Sarthi left." />);

    expect(screen.getByText("Sarthi left.")).toBeInTheDocument();
  });
});
