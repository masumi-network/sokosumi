import type {
  NewsletterSendingDomain,
  NewsletterSendingDomainState,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
  it("shows UTC warm-up usage to members without management controls", () => {
    renderCard({ sendingDomain: WARMING_DOMAIN, canManage: false });
    const warmup = screen.getByRole("region", { name: T.warmup.title });
    expect(
      within(warmup).getByText("Day 0 · 25 of 50 sent today (UTC)"),
    ).toBeInTheDocument();
    expect(within(warmup).getByText(T.warmup.description)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: T.remove.action })).toBeNull();
    expect(screen.queryByRole("button", { name: T.warmup.resume })).toBeNull();
  });

  it("shows Unlimited once the daily cap ends", () => {
    renderCard({
      sendingDomain: {
        ...WARMING_DOMAIN,
        warmup: { ...WARMING_DOMAIN.warmup, day: 28, dailyCap: null },
      },
    });
    expect(
      screen.getByText("Day 28 · 25 sent today (UTC) · Unlimited"),
    ).toBeInTheDocument();
    expect(screen.queryByText(T.warmup.description)).not.toBeInTheDocument();
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
    expect(screen.queryByText(T.verifiedDescription)).not.toBeInTheDocument();
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

  it("keeps DNS records readable without exposing management to agent actors", () => {
    renderCard({ sendingDomain: DOMAIN, canManage: false });
    expect(
      screen.getByRole("region", { name: T.records.title }),
    ).toBeInTheDocument();
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

  it("offers manual setup with relative and full hosts, status, priority, and TTL", async () => {
    renderCard({ sendingDomain: DOMAIN });

    expect(screen.getByText(T.status.PENDING)).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: T.manual.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(T.manual.description)).toBeInTheDocument();
    expect(screen.getByText(T.manual.saved)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: T.manual.action })).toHaveAttribute(
      "href",
      "#newsletter-dns-records",
    );
    const records = screen.getByRole("region", { name: T.records.title });
    expect(
      within(records).getByText(T.records.purpose.dkim.explanation),
    ).toBeInTheDocument();
    expect(
      within(records).getByText(T.records.purpose.bounce.explanation),
    ).toBeInTheDocument();
    expect(within(records).getByText("resend._domainkey")).toBeInTheDocument();
    expect(
      within(records).getByText("resend._domainkey.brand.example"),
    ).toBeInTheDocument();
    expect(within(records).getByText("send")).toBeInTheDocument();
    expect(within(records).getByText("send.brand.example")).toBeInTheDocument();
    expect(within(records).getByText("10")).toBeInTheDocument();
    const [dkimRecord, mxRecord] = within(records).getAllByRole("listitem");
    expect(
      within(dkimRecord).queryByText(T.records.priority),
    ).not.toBeInTheDocument();
    expect(within(mxRecord).getByText(T.records.priority)).toBeInTheDocument();
    expect(within(records).getAllByText("Auto")).toHaveLength(2);
    expect(
      within(records).getAllByRole("button", { name: "Copy" }),
    ).toHaveLength(7);
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

  it("copies each manual DNS field without changing its value", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderCard({ sendingDomain: DOMAIN });
    const records = screen.getByRole("region", { name: T.records.title });
    for (const value of [
      "resend._domainkey",
      "resend._domainkey.brand.example",
      DOMAIN.dnsRecords[0].value,
      "send",
      "send.brand.example",
      DOMAIN.dnsRecords[1].value,
      "10",
    ]) {
      const field = within(records).getByText(value).parentElement;
      expect(field).not.toBeNull();
      if (!field) throw new Error(`Missing copyable field: ${value}`);
      await user.click(within(field).getByRole("button", { name: "Copy" }));
      expect(writeText).toHaveBeenLastCalledWith(value);
    }
  });

  it("shows @ for the apex while retaining the full host", () => {
    renderCard({
      sendingDomain: {
        ...DOMAIN,
        dnsRecords: [{ ...DOMAIN.dnsRecords[0], name: DOMAIN.domain }],
      },
    });
    const records = screen.getByRole("region", { name: T.records.title });
    expect(within(records).getByText("@")).toBeInTheDocument();
    expect(within(records).getByText(DOMAIN.domain)).toBeInTheDocument();
  });

  it("handles trailing dots and mixed case without appending the domain twice", () => {
    renderCard({
      sendingDomain: {
        ...DOMAIN,
        dnsRecords: [
          { ...DOMAIN.dnsRecords[0], name: "Resend._Domainkey.Brand.Example." },
        ],
      },
    });
    const records = screen.getByRole("region", { name: T.records.title });
    expect(within(records).getByText("resend._domainkey")).toBeInTheDocument();
    expect(
      within(records).getByText("Resend._Domainkey.Brand.Example."),
    ).toBeInTheDocument();
  });

  it.each(["pending", "not_started", "not_found", "unknown"])(
    "shows %s as missing",
    (status) => {
      renderCard({
        sendingDomain: {
          ...DOMAIN,
          dnsRecords: [{ ...DOMAIN.dnsRecords[0], status }],
        },
      });
      const records = screen.getByRole("region", { name: T.records.title });
      expect(within(records).getByText(T.records.missing)).toBeInTheDocument();
      expect(
        within(records).queryByText(T.records.failedDescription),
      ).not.toBeInTheDocument();
    },
  );

  it("shows failed records as Wrong value with guidance for missing or incorrect values", () => {
    renderCard({
      sendingDomain: {
        ...DOMAIN,
        dnsRecords: [{ ...DOMAIN.dnsRecords[0], status: "failed" }],
      },
    });
    const records = screen.getByRole("region", { name: T.records.title });
    expect(within(records).getByText("Wrong value")).toBeInTheDocument();
    expect(
      within(records).getByText(T.records.failedDescription),
    ).toBeInTheDocument();
    expect(
      within(records).queryByText(T.records.missing),
    ).not.toBeInTheDocument();
  });

  it("shows troubleshooting when records are missing", () => {
    renderCard({ sendingDomain: DOMAIN });
    expect(screen.getByText(T.troubleshooting.title)).toBeInTheDocument();
    expect(screen.getByText(T.troubleshooting.host)).toBeInTheDocument();
    expect(screen.getByText(T.troubleshooting.quotes)).toBeInTheDocument();
    expect(screen.getByText(T.troubleshooting.propagation)).toBeInTheDocument();
  });

  it("shows compact DNS tips for all supported manual providers", async () => {
    const user = userEvent.setup();
    renderCard({ sendingDomain: DOMAIN });
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
        screen.getByRole("region", { name: T.manual.title }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: T.manual.action })).toBeVisible();
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

  it("allows discovery to be retried after finding a provider", async () => {
    const user = userEvent.setup();
    mocks.connect.mockResolvedValueOnce({
      ok: true,
      value: {
        providerName: "GoDaddy",
        applyUrl: "https://dns.example/domainconnect/apply?x=1",
      },
    });
    mocks.connect.mockResolvedValue({
      ok: true,
      value: {
        providerName: "IONOS",
        applyUrl: "https://dns.example/domainconnect/apply?x=2",
      },
    });
    renderCard({ sendingDomain: DOMAIN });
    expect(
      await screen.findByRole("link", { name: "Connect with GoDaddy" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: T.oneClick.lookup }));
    expect(
      await screen.findByRole("link", { name: "Connect with IONOS" }),
    ).toHaveAttribute("href", "https://dns.example/domainconnect/apply?x=2");
    expect(
      screen.queryByRole("link", { name: "Connect with GoDaddy" }),
    ).not.toBeInTheDocument();
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it.each([
    { lastCheckedAt: new Date("2026-11-03T12:00:00Z") },
    { status: "FAILED" as const },
  ])("refreshes discovery after DNS state changes: %j", async (change) => {
    mocks.connect.mockResolvedValueOnce({
      ok: true,
      value: {
        providerName: "GoDaddy",
        applyUrl: "https://dns.example/domainconnect/apply?x=1",
      },
    });
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
    expect(screen.getByRole("link", { name: T.manual.action })).toBeVisible();
  });

  it("hides the one-click connect link until discovery has succeeded", async () => {
    const lookup = Promise.withResolvers<{ ok: true; value: null }>();
    mocks.connect.mockReturnValue(lookup.promise);
    renderCard({ sendingDomain: DOMAIN });
    expect(screen.getByText(T.oneClick.checking)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Connect with / }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: T.manual.action })).toBeVisible();

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
    expect(screen.getByRole("link", { name: T.manual.action })).toBeVisible();
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
      expect(screen.getByRole("link", { name: T.manual.action })).toBeVisible();
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

  it("hides setup once verified and shows a failure reason when failed", () => {
    const { unmount } = renderCard({
      sendingDomain: { ...DOMAIN, status: "VERIFIED" },
    });
    expect(screen.getByText(T.status.VERIFIED)).toBeInTheDocument();
    expect(screen.getByText(T.verifiedDescription)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: T.checkAgain }),
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
    expect(screen.getByRole("link", { name: T.manual.action })).toBeVisible();
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
