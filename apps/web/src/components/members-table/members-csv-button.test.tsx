import { MemberRole } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MembersCsvButton } from "./members-csv-button";

vi.mock("next-intl", () => {
  const t = Object.assign((key: string) => key, { has: () => true });
  return { useTranslations: () => t };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MembersCsvButton", () => {
  it("downloads the members as a dated CSV named after the organization", async () => {
    vi.useFakeTimers({
      now: new Date("2026-11-16T12:00:00Z"),
      toFake: ["Date"],
    });
    let saved: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      saved = blob as Blob;
      return "blob:members";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(
      <MembersCsvButton
        organizationSlug="utxo"
        members={[
          {
            id: "member-1",
            organizationId: "org-1",
            role: MemberRole.OWNER,
            seatAssignedAt: null,
            createdAt: new Date("2026-01-05T09:00:00Z"),
            user: {
              id: "user-1",
              name: "Ada",
              email: "ada@example.com",
              image: null,
            },
            lastSeenAt: null,
          },
        ]}
        pendingInvitations={[]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "button" }));

    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe("members-utxo-2026-11-16.csv");
    expect(link.href).toBe("blob:members");
    const text = await saved?.text();
    expect(text?.split("\r\n")[1]).toBe(
      '"Ada","ada@example.com","owner","active","2026-01-05","","",""',
    );
  });
});
