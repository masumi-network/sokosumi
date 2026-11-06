import type {
  NewsletterSendingDomain,
  NewsletterSendingDomainState,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  save: vi.fn(),
  check: vi.fn(),
  remove: vi.fn(),
  resume: vi.fn(),
  cloudflare: vi.fn(),
  connect: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/actions/newsletter/sending-domain", () => ({
  saveNewsletterSendingDomain: mocks.save,
  checkNewsletterSendingDomain: mocks.check,
  removeNewsletterSendingDomain: mocks.remove,
  resumeNewsletterSendingDomainWarmup: mocks.resume,
  connectNewsletterSendingDomainWithCloudflare: mocks.cloudflare,
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
  warmup: {
    startedAt: null,
    day: null,
    dailyCap: null,
    sentToday: 0,
    pausedAt: null,
    pauseReason: null,
  },
  createdAt: new Date("2026-10-27T12:00:00Z"),
};
// Nothing found yet, so one-click can stand alone until records are needed.
const UNSTARTED_DOMAIN: NewsletterSendingDomain = {
  ...DOMAIN,
  dnsRecords: DOMAIN.dnsRecords.map((record) => ({
    ...record,
    status: "pending",
  })),
};
const GODADDY = {
  providerName: "GoDaddy",
  applyUrl: "https://dns.example/domainconnect/apply?x=1",
};
const WARMING_DOMAIN: NewsletterSendingDomain = {
  ...DOMAIN,
  status: "VERIFIED",
  warmup: {
    startedAt: new Date("2026-10-27T12:00:00Z"),
    day: 0,
    dailyCap: 50,
    sentToday: 25,
    pausedAt: null,
    pauseReason: null,
  },
};
const PAUSED_DOMAIN: NewsletterSendingDomain = {
  ...WARMING_DOMAIN,
  warmup: {
    ...WARMING_DOMAIN.warmup,
    pausedAt: new Date("2026-10-27T13:00:00Z"),
    pauseReason: "BOUNCE_RATE",
  },
};

function renderCard(state: Partial<NewsletterSendingDomainState> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function card(currentState: Partial<NewsletterSendingDomainState>) {
    return (
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <SendingDomainCard
            state={{
              sendingDomain: null,
              canManage: true,
              fallbackAvailable: true,
              ...currentState,
            }}
            projectId={PROJECT_ID}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  }
  const result = render(card(state));
  return {
    ...result,
    rerenderCard(nextState: Partial<NewsletterSendingDomainState>) {
      result.rerender(card(nextState));
    },
  };
}

// DNS records start collapsed behind whichever toggle the actor gets.
async function openRecords(toggle = T.manual.action) {
  await userEvent.setup().click(screen.getByRole("button", { name: toggle }));
  return screen.getByRole("region", { name: T.records.title });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({ ok: true, value: null });
  mocks.fetch.mockImplementation(async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      "http://localhost",
    );
    const match = url.pathname.match(
      /^\/api\/projects\/([^/]+)\/newsletter\/sending-domain\/domain-connect$/,
    );
    if (!match) throw new Error(`Unexpected discovery path: ${url.pathname}`);
    const result = await mocks.connect({ projectId: match[1] });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SendingDomainCard", () => {
  it("shows warm-up as a quiet chip to members without management controls", async () => {
    renderCard({ sendingDomain: WARMING_DOMAIN, canManage: false });
    const chip = screen.getByRole("button", {
      name: "Warm-up · 25 / 50 today",
    });
    expect(chip).toHaveAccessibleDescription(T.warmup.description);
    expect(screen.queryByRole("region", { name: T.warmup.paused })).toBeNull();
    expect(screen.queryByRole("button", { name: T.remove.action })).toBeNull();
    expect(screen.queryByRole("button", { name: T.warmup.resume })).toBeNull();
  });

  it("hides warm-up once the daily cap ends", () => {
    renderCard({
      sendingDomain: {
        ...WARMING_DOMAIN,
        warmup: { ...WARMING_DOMAIN.warmup, day: 28, dailyCap: null },
      },
    });
    expect(screen.queryByRole("button", { name: /^Warm-up/ })).toBeNull();
    expect(screen.queryByText(T.warmup.description)).not.toBeInTheDocument();
  });

  it("hides warm-up before it starts", () => {
    renderCard({ sendingDomain: { ...DOMAIN, status: "VERIFIED" } });
    expect(screen.queryByRole("button", { name: /^Warm-up/ })).toBeNull();
  });

  it.each([
    ["BOUNCE_RATE", T.warmup.bounceReason],
    ["COMPLAINT_RATE", T.warmup.complaintReason],
  ] as const)("shows a paused %s reason to members", (pauseReason, reason) => {
    renderCard({
      sendingDomain: {
        ...PAUSED_DOMAIN,
        warmup: { ...PAUSED_DOMAIN.warmup, pauseReason },
      },
      canManage: false,
    });
    const warmup = screen.getByRole("region", { name: T.warmup.paused });
    expect(within(warmup).getByText(reason)).toBeInTheDocument();
    expect(
      within(warmup).getByText(T.warmup.pausedDescription),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: T.warmup.resume })).toBeNull();
    expect(screen.queryByText(T.fallback)).not.toBeInTheDocument();
  });

  it("lets a project member resume and refreshes the warm-up status", async () => {
    const user = userEvent.setup();
    mocks.resume.mockResolvedValue({ ok: true, value: WARMING_DOMAIN });
    renderCard({ sendingDomain: PAUSED_DOMAIN });
    await user.click(screen.getByRole("button", { name: T.warmup.resume }));
    await waitFor(() =>
      expect(mocks.resume).toHaveBeenCalledWith({ projectId: PROJECT_ID }),
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it.each(["PENDING", "FAILED"] as const)(
    "keeps the pause visible to members if DNS verification becomes %s",
    (status) => {
      renderCard({
        sendingDomain: { ...PAUSED_DOMAIN, status },
        canManage: false,
      });
      const warmup = screen.getByRole("region", { name: T.warmup.paused });
      expect(
        within(warmup).getByText(T.warmup.bounceReason),
      ).toBeInTheDocument();
      expect(
        within(warmup).getByText(T.warmup.pausedDescription),
      ).toBeInTheDocument();
      expect(screen.queryByText(T.fallback)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: T.warmup.resume }),
      ).toBeNull();
    },
  );

  it("keeps the pause visible and reports a failed resume inline", async () => {
    const user = userEvent.setup();
    mocks.resume.mockResolvedValue({
      ok: false,
      error: { message: T.errors.forbidden },
    });
    renderCard({ sendingDomain: PAUSED_DOMAIN });
    await user.click(screen.getByRole("button", { name: T.warmup.resume }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      T.errors.forbidden,
    );
    expect(screen.getByText(T.warmup.paused)).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("reports a resume request failure without changing the status", async () => {
    const user = userEvent.setup();
    mocks.resume.mockRejectedValue(new Error("Network error"));
    renderCard({ sendingDomain: PAUSED_DOMAIN });
    await user.click(screen.getByRole("button", { name: T.warmup.resume }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      T.errors.generic,
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("lets a project member add a From address", async () => {
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
        projectId: PROJECT_ID,
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

  it("shows the fallback without controls when the actor cannot manage the project", () => {
    renderCard({ canManage: false });
    expect(screen.getByText(T.fallback)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps DNS records readable without exposing management to agent actors", async () => {
    renderCard({ sendingDomain: DOMAIN, canManage: false });
    expect(await openRecords(T.records.title)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: T.oneClick.lookup }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(T.cloudflare.title)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: T.checkAgain }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: T.cloudflare.advanced }),
    ).not.toBeInTheDocument();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: T.remove.action }),
    ).not.toBeInTheDocument();
  });

  it("offers manual setup with a compact host, value, status, and priority", async () => {
    renderCard({ sendingDomain: DOMAIN });

    expect(screen.getByText(T.status.PARTIAL)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: T.manual.action }),
    ).toHaveAttribute("aria-expanded", "false");
    const records = await openRecords();
    expect(
      screen.getByRole("button", { name: T.manual.action }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(within(records).getByText("resend._domainkey")).toBeInTheDocument();
    expect(within(records).getByText("send")).toBeInTheDocument();
    expect(within(records).getByText("10")).toBeInTheDocument();
    const [dkimRecord, mxRecord] = within(records).getAllByRole("listitem");
    expect(
      within(dkimRecord).queryByText(T.records.priority),
    ).not.toBeInTheDocument();
    expect(within(mxRecord).getByText(T.records.priority)).toBeInTheDocument();
    expect(within(records).queryByText("Auto")).not.toBeInTheDocument();
    expect(
      within(records).getAllByRole("button", { name: "Copy" }),
    ).toHaveLength(4);
    expect(within(records).getByText(T.records.found)).toBeInTheDocument();
    expect(within(records).getByText(T.records.missing)).toBeInTheDocument();

    expect(await screen.findByText(T.oneClick.unavailable)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: T.cloudflare.advanced }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(T.cloudflare.title)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: T.checkAgain }),
    ).toBeInTheDocument();
  });

  it("hides each explanation behind its purpose without losing it for screen readers", async () => {
    const user = userEvent.setup();
    renderCard({ sendingDomain: DOMAIN });
    const records = await openRecords();
    const purpose = within(records).getByRole("button", {
      name: T.records.purpose.dkim.label,
    });
    expect(purpose).toHaveAccessibleDescription(
      T.records.purpose.dkim.explanation,
    );
    expect(
      within(records).getByText(T.records.purpose.dkim.explanation),
    ).toHaveClass("sr-only");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await user.hover(purpose);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      T.records.purpose.dkim.explanation,
    );
  });

  it("keeps the provider tips and Cloudflare accordions collapsed by default", async () => {
    renderCard({ sendingDomain: DOMAIN });
    expect(await screen.findByText(T.oneClick.unavailable)).toBeInTheDocument();
    await openRecords();
    for (const name of [T.providerTips.title, T.cloudflare.advanced]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    }
  });

  it("copies each manual DNS field without changing its value", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderCard({ sendingDomain: DOMAIN });
    const records = await openRecords();
    for (const value of [
      "resend._domainkey",
      DOMAIN.dnsRecords[0].value,
      "send",
      DOMAIN.dnsRecords[1].value,
    ]) {
      const field = within(records).getByText(value).parentElement;
      expect(field).not.toBeNull();
      if (!field) throw new Error(`Missing copyable field: ${value}`);
      await user.click(within(field).getByRole("button", { name: "Copy" }));
      expect(writeText).toHaveBeenLastCalledWith(value);
    }
  });

  it("shows @ for the apex while retaining the full host", async () => {
    renderCard({
      sendingDomain: {
        ...DOMAIN,
        dnsRecords: [{ ...DOMAIN.dnsRecords[0], name: DOMAIN.domain }],
      },
    });
    const records = await openRecords();
    expect(within(records).getByText("@")).toBeInTheDocument();
    expect(
      within(records).getByRole("button", { name: T.records.relativeName }),
    ).toHaveAccessibleDescription(`${T.records.fullName}: ${DOMAIN.domain}`);
  });

  it("falls back to the full name for a host outside the domain", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderCard({
      sendingDomain: {
        ...DOMAIN,
        dnsRecords: [{ ...DOMAIN.dnsRecords[0], name: "mail.other.example" }],
      },
    });
    const records = await openRecords();
    expect(within(records).getByText(T.records.fullName)).toBeInTheDocument();
    expect(
      within(records).queryByText(T.records.relativeName),
    ).not.toBeInTheDocument();
    const field = within(records).getByText("mail.other.example").parentElement;
    if (!field) throw new Error("Missing copyable host");
    await user.click(within(field).getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenLastCalledWith("mail.other.example");
  });

  it("handles trailing dots and mixed case without appending the domain twice", async () => {
    renderCard({
      sendingDomain: {
        ...DOMAIN,
        dnsRecords: [
          { ...DOMAIN.dnsRecords[0], name: "Resend._Domainkey.Brand.Example." },
        ],
      },
    });
    const records = await openRecords();
    expect(within(records).getByText("resend._domainkey")).toBeInTheDocument();
    expect(
      within(records).getByRole("button", { name: T.records.relativeName }),
    ).toHaveAccessibleDescription(
      `${T.records.fullName}: Resend._Domainkey.Brand.Example.`,
    );
  });

  it.each(["pending", "not_started", "not_found", "unknown"])(
    "shows %s as missing",
    async (status) => {
      renderCard({
        sendingDomain: {
          ...DOMAIN,
          dnsRecords: [{ ...DOMAIN.dnsRecords[0], status }],
        },
      });
      const records = await openRecords();
      expect(within(records).getByText(T.records.missing)).toBeInTheDocument();
      expect(
        within(records).queryByText(T.records.failedDescription),
      ).not.toBeInTheDocument();
    },
  );

  it("shows failed records as Wrong value with guidance for missing or incorrect values", async () => {
    renderCard({
      sendingDomain: {
        ...DOMAIN,
        dnsRecords: [{ ...DOMAIN.dnsRecords[0], status: "failed" }],
      },
    });
    const records = await openRecords();
    expect(within(records).getByText("Wrong value")).toBeInTheDocument();
    expect(
      within(records).getByText(T.records.failedDescription),
    ).toBeInTheDocument();
    expect(
      within(records).queryByText(T.records.missing),
    ).not.toBeInTheDocument();
  });

  it("shows troubleshooting when records are missing", async () => {
    const user = userEvent.setup();
    renderCard({ sendingDomain: DOMAIN });
    await openRecords();
    await user.click(
      screen.getByRole("button", { name: T.troubleshooting.title }),
    );
    expect(screen.getByText(T.troubleshooting.host)).toBeInTheDocument();
    expect(screen.getByText(T.troubleshooting.quotes)).toBeInTheDocument();
    expect(screen.getByText(T.troubleshooting.propagation)).toBeInTheDocument();
  });

  it("shows compact DNS tips for all supported manual providers", async () => {
    const user = userEvent.setup();
    renderCard({ sendingDomain: DOMAIN });
    await openRecords();
    await user.click(
      screen.getByRole("button", { name: T.providerTips.title }),
    );
    const tips = screen.getByRole("region", { name: T.providerTips.title });
    expect(
      within(tips).getByText(T.providerTips.description),
    ).toBeInTheDocument();
    for (const provider of Object.values(T.providerTips.providers)) {
      const trigger = within(tips).getByRole("button", { name: provider.name });
      await user.click(trigger);
      expect(within(tips).getByText(provider.host)).toBeInTheDocument();
      expect(within(tips).getByText(provider.extra)).toBeInTheDocument();
    }
  });

  it("verifies the current project’s records and offers Check again afterward", async () => {
    const user = userEvent.setup();
    mocks.check.mockResolvedValue({ ok: true, value: DOMAIN });
    renderCard({ sendingDomain: { ...DOMAIN, lastCheckedAt: null } });
    await user.click(screen.getByRole("button", { name: T.verifyRecords }));
    await waitFor(() =>
      expect(mocks.check).toHaveBeenCalledWith({ projectId: PROJECT_ID }),
    );
    expect(
      screen.getByRole("button", { name: T.checkAgain }),
    ).toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it.each(["GoDaddy", "IONOS"])(
    "automatically discovers %s and offers one-click beside manual setup",
    async (providerName) => {
      const applyUrl = "https://dns.example/domainconnect/apply?x=1";
      mocks.connect.mockResolvedValue({
        ok: true,
        value: { providerName, applyUrl },
      });
      renderCard({ sendingDomain: DOMAIN });

      const link = await screen.findByRole("link", {
        name: `Connect with ${providerName}`,
      });
      expect(link).toHaveAttribute("href", applyUrl);
      expect(
        screen.getByRole("button", { name: T.manual.action }),
      ).toBeVisible();
      expect(mocks.connect).toHaveBeenCalledExactlyOnceWith({
        projectId: PROJECT_ID,
      });
      expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(
        `/api/projects/${PROJECT_ID}/newsletter/sending-domain/domain-connect`,
        expect.objectContaining({
          cache: "no-store",
          signal: expect.any(AbortSignal),
        }),
      );
    },
  );

  it.each([
    {
      status: "VERIFIED" as const,
      dnsRecords: [
        {
          ...DOMAIN.dnsRecords[0],
          record: "DMARC",
          name: "_dmarc.brand.example",
          value: "v=DMARC1; p=none;",
          status: "not_found",
        },
      ],
    },
    {
      dnsRecords: [{ ...DOMAIN.dnsRecords[0], value: "p=rotated" }],
    },
  ])(
    "refreshes discovery when the apply URL would change: %j",
    async (change) => {
      mocks.connect.mockResolvedValueOnce({ ok: true, value: GODADDY });
      mocks.connect.mockResolvedValue({
        ok: true,
        value: {
          providerName: "IONOS",
          applyUrl: "https://dns.example/domainconnect/apply?x=2",
        },
      });
      const { rerenderCard } = renderCard({ sendingDomain: DOMAIN });
      expect(
        await screen.findByRole("link", { name: "Connect with GoDaddy" }),
      ).toBeInTheDocument();
      rerenderCard({ sendingDomain: { ...DOMAIN, ...change } });
      expect(
        await screen.findByRole("link", { name: "Connect with IONOS" }),
      ).toHaveAttribute("href", "https://dns.example/domainconnect/apply?x=2");
      expect(mocks.connect).toHaveBeenCalledTimes(2);
    },
  );

  it("only reports the verification result when pressing Check again", async () => {
    const user = userEvent.setup();
    const checked = {
      ...DOMAIN,
      status: "FAILED" as const,
      lastCheckedAt: new Date("2026-11-04T12:00:00Z"),
    };
    mocks.check.mockResolvedValue({ ok: true, value: checked });
    const { rerenderCard } = renderCard({ sendingDomain: DOMAIN });
    expect(await screen.findByText(T.oneClick.unavailable)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: T.checkAgain }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    rerenderCard({ sendingDomain: checked });

    expect(toast.info).toHaveBeenCalledExactlyOnceWith(
      "1 of 2 DNS records found. Review their status below; DNS changes can take a few hours.",
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByText(T.oneClick.checking)).not.toBeInTheDocument();
    expect(mocks.connect).toHaveBeenCalledOnce();
  });

  it("keeps the success toast for a check that verifies the domain", async () => {
    const user = userEvent.setup();
    mocks.check.mockResolvedValue({
      ok: true,
      value: { ...DOMAIN, status: "VERIFIED" },
    });
    renderCard({ sendingDomain: DOMAIN });
    await user.click(screen.getByRole("button", { name: T.checkAgain }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledExactlyOnceWith(T.verifiedToast),
    );
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("counts the checked result in the toast, not the stale card", async () => {
    const user = userEvent.setup();
    mocks.check.mockResolvedValue({ ok: true, value: UNSTARTED_DOMAIN });
    renderCard({ sendingDomain: DOMAIN });
    await user.click(screen.getByRole("button", { name: T.checkAgain }));
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(/^0 of 2 DNS records found\./),
      ),
    );
  });

  describe("purpose health row", () => {
    const record = DOMAIN.dnsRecords[0];
    const healthRow = () => screen.getByRole("list", { name: T.records.title });
    const chips = () =>
      within(healthRow())
        .getAllByRole("button")
        .map((chip) => chip.textContent);

    it("shows each purpose in a fixed order with found and missing apart", () => {
      renderCard({
        sendingDomain: {
          ...DOMAIN,
          dnsRecords: [
            { ...record, record: "DMARC", status: "not_found" },
            { ...record, record: "SPF", type: "TXT", status: "pending" },
            { ...record, record: "SPF", type: "CNAME", status: "pending" },
            { ...record, record: "DKIM", status: "verified" },
          ],
        },
      });
      expect(chips()).toEqual([
        "DKIMFound",
        "Return pathMissing",
        "SPFMissing",
        "DMARCMissing",
      ]);
      const [dkim, returnPath] = within(healthRow()).getAllByRole("listitem");
      expect(dkim).toHaveClass("text-foreground");
      expect(returnPath).toHaveClass("text-muted-foreground");
    });

    it("marks a failed record as wrong and reads a purpose as its worst record", () => {
      renderCard({
        sendingDomain: {
          ...DOMAIN,
          status: "FAILED",
          dnsRecords: [
            { ...record, name: "a.brand.example", status: "verified" },
            { ...record, name: "b.brand.example", status: "failed" },
          ],
        },
      });
      expect(chips()).toEqual(["DKIMWrong value"]);
      expect(within(healthRow()).getByRole("listitem")).toHaveClass(
        "text-semantic-destructive",
      );
    });

    it("gives way to a one-line DMARC hint on a verified domain", () => {
      renderCard({
        sendingDomain: {
          ...DOMAIN,
          status: "VERIFIED",
          dnsRecords: [
            { ...record, status: "verified" },
            { ...record, record: "DMARC", status: "not_found" },
          ],
        },
      });
      expect(screen.queryByRole("list", { name: T.records.title })).toBeNull();
      expect(
        screen.getByRole("button", { name: T.dmarc.title }),
      ).toHaveAccessibleDescription(T.dmarc.description);
    });

    it("folds the missing DMARC notice into its chip while pending", () => {
      renderCard({
        sendingDomain: {
          ...DOMAIN,
          dnsRecords: [
            { ...record, status: "pending" },
            { ...record, record: "DMARC", status: "not_found" },
          ],
        },
      });
      const chips = within(healthRow()).getAllByRole("button");
      expect(chips[0]).toHaveAccessibleDescription(
        T.records.purpose.dkim.explanation,
      );
      expect(chips[1]).toHaveAccessibleDescription(T.dmarc.description);
      expect(screen.queryByRole("button", { name: T.dmarc.title })).toBeNull();
    });

    it("sits beside the records instead of replacing them, also for members", async () => {
      renderCard({ sendingDomain: DOMAIN, canManage: false });
      expect(chips()).toEqual(["DKIMMissing", "Return pathFound"]);
      expect(await openRecords(T.records.title)).toBeInTheDocument();
    });

    it("is gone once no DNS is needed", () => {
      renderCard({
        sendingDomain: {
          ...DOMAIN,
          status: "VERIFIED",
          dnsRecords: [{ ...record, status: "verified" }],
        },
      });
      expect(screen.queryByRole("list", { name: T.records.title })).toBeNull();
    });
  });

  it("makes one-click the primary action and keeps manual one click away", async () => {
    const user = userEvent.setup();
    mocks.connect.mockResolvedValue({ ok: true, value: GODADDY });
    renderCard({ sendingDomain: UNSTARTED_DOMAIN });

    const link = await screen.findByRole("link", {
      name: "Connect with GoDaddy",
    });
    expect(link).toHaveClass("bg-primary");
    expect(screen.getByRole("button", { name: T.checkAgain })).not.toHaveClass(
      "bg-primary",
    );
    expect(screen.getByText(T.status.PENDING)).toBeInTheDocument();
    expect(screen.getByText("0 of 2 DNS records found")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: T.records.title })).toBeNull();

    await user.click(screen.getByRole("button", { name: T.manual.action }));
    expect(
      screen.getByRole("region", { name: T.records.title }),
    ).toBeInTheDocument();
  });

  it("opens the records once a check finds them still unverified", async () => {
    const user = userEvent.setup();
    mocks.connect.mockResolvedValue({ ok: true, value: GODADDY });
    mocks.check.mockResolvedValue({ ok: true, value: UNSTARTED_DOMAIN });
    renderCard({ sendingDomain: UNSTARTED_DOMAIN });
    await screen.findByRole("link", { name: "Connect with GoDaddy" });
    expect(screen.queryByRole("region", { name: T.records.title })).toBeNull();

    await user.click(screen.getByRole("button", { name: T.checkAgain }));
    expect(
      await screen.findByRole("region", { name: T.records.title }),
    ).toBeInTheDocument();
  });

  it("keeps records collapsed and Check primary without one-click", async () => {
    renderCard({ sendingDomain: UNSTARTED_DOMAIN });
    expect(await screen.findByText(T.oneClick.unavailable)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: T.records.title })).toBeNull();
    expect(screen.getByRole("button", { name: T.checkAgain })).toHaveClass(
      "bg-primary",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("explains fallback and last check in the status tooltip, not the body", () => {
    renderCard({ sendingDomain: UNSTARTED_DOMAIN });
    const status = screen.getByRole("button", { name: T.status.PENDING });
    expect(status).toHaveAccessibleDescription(
      expect.stringContaining(T.fallback),
    );
    expect(status).toHaveAccessibleDescription(
      expect.stringContaining("Last checked"),
    );
  });

  it("names the blocker in the tooltip when there is no fallback", () => {
    renderCard({ sendingDomain: UNSTARTED_DOMAIN, fallbackAvailable: false });
    expect(
      screen.getByRole("button", { name: T.status.PENDING }),
    ).toHaveAccessibleDescription(expect.stringContaining(T.noFallback));
  });

  it("skips the count when there are no records yet", () => {
    renderCard({ sendingDomain: { ...DOMAIN, dnsRecords: [] } });
    expect(screen.queryByText(/DNS records found/)).toBeNull();
  });

  it("counts partial progress and leaves the optional DMARC record out", async () => {
    renderCard({
      sendingDomain: {
        ...DOMAIN,
        dnsRecords: [
          ...DOMAIN.dnsRecords,
          {
            ...DOMAIN.dnsRecords[0],
            record: "DMARC",
            name: "_dmarc.brand.example",
            value: "v=DMARC1; p=none;",
            status: "not_found",
          },
        ],
      },
    });
    expect(screen.getByText(T.status.PARTIAL)).toBeInTheDocument();
    expect(screen.getByText("1 of 2 DNS records found")).toBeInTheDocument();
    await screen.findByText(T.oneClick.unavailable);
  });

  it.each([
    ["MX", "bounce"],
    ["CNAME", "bounce"],
    ["TXT", "spf"],
  ] as const)("labels an SPF-group %s record as %s", async (type, purpose) => {
    renderCard({
      sendingDomain: {
        ...DOMAIN,
        dnsRecords: [
          {
            record: "SPF",
            type,
            name: "rsend.brand.example",
            value: "return.resend.example",
            ttl: "Auto",
            priority: null,
            status: "pending",
          },
        ],
      },
    });
    const records = await openRecords();
    expect(
      within(records).getByText(T.records.purpose[purpose].label),
    ).toBeInTheDocument();
    expect(
      within(records).getByText(T.records.purpose[purpose].explanation),
    ).toBeInTheDocument();
    expect(within(records).getByText(type)).toBeInTheDocument();
  });

  it("wraps long hosts between labels, not inside them", async () => {
    renderCard({
      sendingDomain: {
        ...DOMAIN,
        dnsRecords: [
          {
            ...DOMAIN.dnsRecords[0],
            name: "resend._domainkey.other.example",
          },
        ],
      },
    });
    const records = await openRecords();
    const host = within(records).getByText("resend._domainkey.other.example");
    expect(host.querySelectorAll("wbr")).toHaveLength(3);
    expect(host).toHaveClass("break-words");
    expect(host).not.toHaveClass("wrap-anywhere");
  });

  it("truncates a long value but keeps all of it for hover and copy", async () => {
    renderCard({ sendingDomain: DOMAIN });
    const records = await openRecords();
    const value = within(records).getByText(DOMAIN.dnsRecords[0].value);
    expect(value).toHaveClass("whitespace-nowrap");
    expect(value.closest("dd")).toHaveAttribute(
      "title",
      DOMAIN.dnsRecords[0].value,
    );
  });

  it("offers a lookup retry only while no provider is found", async () => {
    const user = userEvent.setup();
    mocks.connect.mockResolvedValue({ ok: true, value: GODADDY });
    renderCard({ sendingDomain: DOMAIN });
    await screen.findByRole("link", { name: "Connect with GoDaddy" });
    expect(
      screen.queryByRole("button", { name: T.oneClick.lookup }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: T.manual.action }));
    expect(
      screen.queryByRole("button", { name: T.oneClick.lookup }),
    ).toBeNull();
  });

  it.each([
    { providerName: "GoDaddy" },
    { providerName: "GoDaddy", applyUrl: "http://dns.example/apply" },
    { providerName: "GoDaddy", applyUrl: "javascript:alert(1)" },
  ])("rejects malformed or unsafe discovery results: %j", async (provider) => {
    mocks.connect.mockResolvedValue({ ok: true, value: provider });
    renderCard({ sendingDomain: DOMAIN });
    expect(await screen.findByText(T.errors.generic)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Connect with / }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.manual.action })).toBeVisible();
  });

  it("hides the one-click connect link until discovery has succeeded", async () => {
    const lookup = Promise.withResolvers<{ ok: true; value: null }>();
    mocks.connect.mockReturnValue(lookup.promise);
    renderCard({ sendingDomain: DOMAIN });
    expect(screen.getByText(T.oneClick.checking)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Connect with / }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.manual.action })).toBeVisible();

    lookup.resolve({ ok: true, value: null });
    expect(await screen.findByText(T.oneClick.unavailable)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Connect with / }),
    ).not.toBeInTheDocument();
  });

  it("keeps manual setup available and retries unavailable one-click discovery", async () => {
    const user = userEvent.setup();
    mocks.connect.mockResolvedValueOnce({ ok: true, value: null });
    mocks.connect.mockResolvedValue({
      ok: true,
      value: {
        providerName: "GoDaddy",
        applyUrl: "https://dns.example/domainconnect/apply?x=1",
      },
    });
    renderCard({ sendingDomain: DOMAIN });
    expect(await screen.findByText(T.oneClick.unavailable)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.manual.action })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Connect with / }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: T.oneClick.lookup }));
    expect(
      await screen.findByRole("link", { name: "Connect with GoDaddy" }),
    ).toBeInTheDocument();
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it.each(["result", "request"])(
    "keeps manual setup and retries after a discovery %s error",
    async (failure) => {
      const user = userEvent.setup();
      if (failure === "result") {
        mocks.connect.mockResolvedValueOnce({
          ok: false,
          error: { message: T.errors.forbidden },
        });
      } else {
        mocks.connect.mockRejectedValueOnce(new Error("Network error"));
      }
      renderCard({ sendingDomain: DOMAIN });
      expect(
        await screen.findByText(
          failure === "result" ? T.errors.forbidden : T.errors.generic,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: T.manual.action }),
      ).toBeVisible();
      expect(
        screen.queryByRole("link", { name: /Connect with / }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: T.oneClick.lookup }));
      expect(
        await screen.findByText(T.oneClick.unavailable),
      ).toBeInTheDocument();
      expect(mocks.connect).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps the one-time Cloudflare token form behind an advanced option", async () => {
    const user = userEvent.setup();
    renderCard({ sendingDomain: DOMAIN });
    expect(
      screen.queryByRole("button", { name: T.cloudflare.advanced }),
    ).toBeNull();
    await openRecords();
    expect(screen.queryByLabelText(T.cloudflare.title)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: T.cloudflare.advanced }),
    );
    expect(screen.getByLabelText(T.cloudflare.title)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByText(T.cloudflare.description)).toBeInTheDocument();
  });

  it("sends the Cloudflare token once and clears the field", async () => {
    const user = userEvent.setup();
    mocks.cloudflare.mockResolvedValue({ ok: true, value: DOMAIN });
    renderCard({ sendingDomain: DOMAIN });
    await openRecords();
    await user.click(
      screen.getByRole("button", { name: T.cloudflare.advanced }),
    );
    const input = screen.getByLabelText(T.cloudflare.title);
    await user.type(input, "cf-secret-token-0123456789abcdef");
    await user.click(screen.getByRole("button", { name: T.cloudflare.submit }));
    await waitFor(() =>
      expect(mocks.cloudflare).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        apiToken: "cf-secret-token-0123456789abcdef",
      }),
    );
    expect(input).toHaveValue("");
  });

  it("hides setup once verified and shows a failure reason when failed", async () => {
    const user = userEvent.setup();
    const { unmount } = renderCard({
      sendingDomain: { ...DOMAIN, status: "VERIFIED" },
    });
    const verified = screen.getByText(T.status.VERIFIED);
    expect(verified).toHaveClass("bg-semantic-success");
    expect(
      screen.getByRole("button", { name: T.status.VERIFIED }),
    ).toHaveAccessibleDescription(expect.stringContaining("Last checked"));
    expect(screen.queryByText(/^Last checked/)).toHaveClass("sr-only");
    expect(screen.queryByText(/DNS records found/)).toBeNull();
    expect(screen.getByRole("button", { name: T.remove.action })).toHaveClass(
      "text-muted-foreground",
    );
    expect(
      screen.queryByRole("button", { name: T.checkAgain }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(T.cloudflare.title)).not.toBeInTheDocument();
    // Still there for reference, just out of the way.
    expect(screen.queryByRole("region", { name: T.records.title })).toBeNull();
    await user.click(screen.getByRole("button", { name: T.records.title }));
    expect(
      screen.getByRole("region", { name: T.records.title }),
    ).toBeInTheDocument();
    expect(mocks.connect).not.toHaveBeenCalled();
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
    expect(screen.getByText(T.statusDetail.FAILED)).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: T.records.title }),
    ).toBeInTheDocument();
  });

  it("warns about a missing DMARC policy and lists the p=none record", async () => {
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
    expect(screen.getByText(T.status.VERIFIED)).toHaveClass(
      "bg-semantic-success",
    );
    expect(screen.getByText(T.dmarc.title)).toBeInTheDocument();
    // Quiet beside the success state: nothing here is a primary action.
    expect(screen.getByRole("button", { name: T.checkAgain })).not.toHaveClass(
      "bg-primary",
    );
    const records = await openRecords();
    expect(within(records).getByText("v=DMARC1; p=none;")).toBeInTheDocument();
    expect(
      within(records).getByText(T.records.purpose.dmarc.explanation),
    ).toBeInTheDocument();
    // Verified, but DMARC still needs adding: setup and Check now stay.
    expect(screen.getByRole("button", { name: T.manual.action })).toBeVisible();
    expect(
      screen.getByRole("button", { name: T.cloudflare.advanced }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: T.checkAgain }),
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
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({ projectId: PROJECT_ID }),
    );
  });
});
