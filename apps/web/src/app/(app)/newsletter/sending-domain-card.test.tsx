import type {
  NewsletterSendingDomain,
  NewsletterSendingDomainState,
} from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  save: vi.fn(),
  check: vi.fn(),
  remove: vi.fn(),
  cloudflare: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/newsletter/sending-domain", () => ({
  saveNewsletterSendingDomain: mocks.save,
  checkNewsletterSendingDomain: mocks.check,
  removeNewsletterSendingDomain: mocks.remove,
  connectNewsletterSendingDomainWithCloudflare: mocks.cloudflare,
  getNewsletterSendingDomainConnect: mocks.connect,
}));

import { SendingDomainCard } from "./sending-domain-card";

const T = en.App.Projects.Newsletter.SendingDomain;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const DOMAIN: NewsletterSendingDomain = {
  id: "d1",
  domain: "brand.example",
  fromAddress: "news@brand.example",
  status: "PENDING",
  dnsRecords: [
    {
      record: "DKIM",
      type: "TXT",
      name: "resend._domainkey.brand.example",
      value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC".repeat(4),
      ttl: "Auto",
      priority: null,
      status: "pending",
    },
    {
      record: "SPF",
      type: "MX",
      name: "send.brand.example",
      value: "feedback-smtp.us-east-1.amazonses.com",
      ttl: "Auto",
      priority: 10,
      status: "verified",
    },
  ],
  lastCheckedAt: new Date("2026-10-27T12:00:00Z"),
  failureReason: null,
  createdAt: new Date("2026-10-27T12:00:00Z"),
};

function renderCard(state: Partial<NewsletterSendingDomainState> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <SendingDomainCard
        state={{
          sendingDomain: null,
          canManage: true,
          fallbackAvailable: true,
          ...state,
        }}
        projectId={PROJECT_ID}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SendingDomainCard", () => {
  it("lets an admin add a From address", async () => {
    const user = userEvent.setup();
    mocks.save.mockResolvedValue({ ok: true, value: DOMAIN });
    renderCard();

    expect(screen.getByRole("heading", { name: T.title })).toBeInTheDocument();
    expect(screen.getByText(T.fallback)).toBeInTheDocument();
    // A dedicated subdomain is the suggested default.
    expect(screen.getByLabelText(T.fromAddress)).toHaveAttribute(
      "placeholder",
      "news@news.yourbrand.com",
    );
    expect(screen.getByText(T.fromAddressHint)).toBeInTheDocument();
    await user.type(screen.getByLabelText(T.fromAddress), "news@brand.example");
    await user.click(screen.getByRole("button", { name: T.add }));

    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        fromAddress: "news@brand.example",
      }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows the error next to the field", async () => {
    const user = userEvent.setup();
    mocks.save.mockResolvedValue({
      ok: false,
      error: { message: T.errors.invalidAddress },
    });
    renderCard();
    await user.click(screen.getByRole("button", { name: T.add }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      T.errors.invalidAddress,
    );
    expect(screen.getByLabelText(T.fromAddress)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("tells a member who manages it, with no controls", () => {
    renderCard({ canManage: false });
    expect(screen.getByText(T.managedByAdmins)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("explains each DNS record and offers every way to connect while pending", () => {
    renderCard({ sendingDomain: DOMAIN });

    expect(screen.getByText(T.status.PENDING)).toBeInTheDocument();
    const records = screen.getByRole("region", { name: T.records.title });
    expect(
      within(records).getByText(T.records.purpose.dkim.explanation),
    ).toBeInTheDocument();
    expect(
      within(records).getByText(T.records.purpose.bounce.explanation),
    ).toBeInTheDocument();
    expect(within(records).getByText("send.brand.example")).toBeInTheDocument();
    expect(
      within(records).getAllByRole("button", { name: "Copy" }),
    ).toHaveLength(5);
    expect(within(records).getByLabelText(T.records.found)).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: T.oneClick.lookup }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(T.cloudflare.title)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByText(T.cloudflare.description)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: T.checkNow }),
    ).toBeInTheDocument();
  });

  it("finds a Domain Connect provider and links to its apply URL", async () => {
    const user = userEvent.setup();
    mocks.connect.mockResolvedValue({
      ok: true,
      value: {
        providerName: "Cloudflare",
        applyUrl: "https://dash.cloudflare.com/domainconnect/apply?x=1",
      },
    });
    renderCard({ sendingDomain: DOMAIN });

    await user.click(screen.getByRole("button", { name: T.oneClick.lookup }));

    const link = await screen.findByRole("link", {
      name: "Connect with Cloudflare",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://dash.cloudflare.com/domainconnect/apply?x=1",
    );
    expect(mocks.connect).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  it("falls back to the other options when one-click setup is unavailable", async () => {
    const user = userEvent.setup();
    mocks.connect.mockResolvedValue({ ok: true, value: null });
    renderCard({ sendingDomain: DOMAIN });
    await user.click(screen.getByRole("button", { name: T.oneClick.lookup }));
    expect(await screen.findByText(T.oneClick.unavailable)).toBeInTheDocument();
  });

  it("sends the Cloudflare token once and clears the field", async () => {
    const user = userEvent.setup();
    mocks.cloudflare.mockResolvedValue({ ok: true, value: DOMAIN });
    renderCard({ sendingDomain: DOMAIN });
    const input = screen.getByLabelText(T.cloudflare.title);
    await user.type(input, "cf-secret-token-0123456789abcdef");
    await user.click(screen.getByRole("button", { name: T.cloudflare.submit }));
    await waitFor(() =>
      expect(mocks.cloudflare).toHaveBeenCalledWith({
        apiToken: "cf-secret-token-0123456789abcdef",
      }),
    );
    expect(input).toHaveValue("");
  });

  it("hides setup once verified and shows a failure reason when failed", () => {
    const { unmount } = renderCard({
      sendingDomain: { ...DOMAIN, status: "VERIFIED" },
    });
    expect(screen.getByText(T.status.VERIFIED)).toBeInTheDocument();
    expect(screen.getByText(T.verifiedDescription)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: T.checkNow }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(T.cloudflare.title)).not.toBeInTheDocument();
    unmount();

    renderCard({
      sendingDomain: {
        ...DOMAIN,
        status: "FAILED",
        failureReason: "Resend could not find these DNS records: DKIM",
      },
    });
    expect(screen.getByText(T.status.FAILED)).toBeInTheDocument();
    expect(
      screen.getByText("Resend could not find these DNS records: DKIM"),
    ).toBeInTheDocument();
  });

  it("warns about a missing DMARC policy and lists the p=none record", () => {
    renderCard({
      sendingDomain: {
        ...DOMAIN,
        status: "VERIFIED",
        dnsRecords: [
          ...DOMAIN.dnsRecords,
          {
            record: "DMARC",
            type: "TXT",
            name: "_dmarc.brand.example",
            value: "v=DMARC1; p=none;",
            ttl: "Auto",
            priority: null,
            status: "not_found",
          },
        ],
      },
    });
    expect(screen.getByText(T.dmarc.title)).toBeInTheDocument();
    const records = screen.getByRole("region", { name: T.records.title });
    expect(within(records).getByText("v=DMARC1; p=none;")).toBeInTheDocument();
    expect(
      within(records).getByText(T.records.purpose.dmarc.explanation),
    ).toBeInTheDocument();
    // Verified, but DMARC still needs adding: setup and Check now stay.
    expect(screen.getByLabelText(T.cloudflare.title)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: T.checkNow }),
    ).toBeInTheDocument();
  });

  it("drops the warning once DMARC is published", () => {
    renderCard({
      sendingDomain: {
        ...DOMAIN,
        dnsRecords: [
          {
            record: "DMARC",
            type: "TXT",
            name: "_dmarc.brand.example",
            value: "v=DMARC1; p=none;",
            ttl: "Auto",
            priority: null,
            status: "verified",
          },
        ],
      },
    });
    expect(screen.queryByText(T.dmarc.title)).not.toBeInTheDocument();
  });

  it("confirms before removing the domain", async () => {
    const user = userEvent.setup();
    mocks.remove.mockResolvedValue({ ok: true, value: null });
    renderCard({ sendingDomain: DOMAIN });
    await user.click(screen.getByRole("button", { name: T.remove.action }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: T.remove.action }),
    );
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({}));
  });
});
