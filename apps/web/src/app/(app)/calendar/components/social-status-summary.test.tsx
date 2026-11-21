import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { SocialStatusSummary } from "./social-status-summary";

function renderSummary(
  postCount: number,
  counts: Map<"SCHEDULED", number> = new Map(),
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SocialStatusSummary
        counts={counts}
        onPostStatusChange={vi.fn()}
        postCount={postCount}
        postStatus={null}
        statuses={["SCHEDULED"]}
      />
    </NextIntlClientProvider>,
  );
}

describe("SocialStatusSummary", () => {
  it("leaves an empty period to the calendar's empty panel", () => {
    const { container } = renderSummary(0);

    expect(container).toBeEmptyDOMElement();
  });

  it("counts the period's posts", () => {
    renderSummary(2, new Map([["SCHEDULED", 2]]));

    expect(screen.getByTestId("calendar-post-count")).toHaveTextContent(
      "2 posts",
    );
  });
});
