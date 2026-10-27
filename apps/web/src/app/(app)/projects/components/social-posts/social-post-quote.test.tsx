import type { SocialPost } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { useReportMovedSocialPostQuotes } from "./social-post-quote";

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));

function ReportMovedQuotes({
  post,
}: {
  post: Pick<SocialPost, "movedQuotes">;
}) {
  const report = useReportMovedSocialPostQuotes();
  return (
    <button type="button" onClick={() => report(post)}>
      Report moved quotes
    </button>
  );
}

describe("moved quote toast", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["en", en, 1, "Also moved 1 quote to keep it after this post"],
    ["en", en, 3, "Also moved 3 quotes to keep them after this post"],
    [
      "de",
      de,
      1,
      "Außerdem 1 Zitat verschoben, damit es nach diesem Beitrag erscheint",
    ],
    [
      "de",
      de,
      3,
      "Außerdem 3 Zitate verschoben, damit sie nach diesem Beitrag erscheinen",
    ],
    [
      "es",
      es,
      1,
      "También se movió 1 cita para que aparezca después de esta publicación",
    ],
    [
      "es",
      es,
      3,
      "También se movieron 3 citas para que aparezcan después de esta publicación",
    ],
  ] as const)(
    "reports moved quotes with ICU plurals in %s",
    (locale, messages, count, message) => {
      const movedQuotes = Array.from({ length: count }, (_, index) => ({
        id: `quote-${index}`,
        scheduledAt: new Date("2026-10-27T10:00:00Z"),
      }));
      render(
        <NextIntlClientProvider
          locale={locale}
          timeZone="UTC"
          messages={messages}
        >
          <ReportMovedQuotes post={{ movedQuotes }} />
        </NextIntlClientProvider>,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Report moved quotes" }),
      );
      expect(toastSuccess).toHaveBeenCalledWith(message);
    },
  );

  it.each([{}, { movedQuotes: [] }])(
    "stays quiet when no quote moved",
    (post) => {
      render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
          <ReportMovedQuotes post={post} />
        </NextIntlClientProvider>,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Report moved quotes" }),
      );
      expect(toastSuccess).not.toHaveBeenCalled();
    },
  );
});
