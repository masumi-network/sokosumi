import { beforeEach, describe, expect, it, vi } from "vitest";

import { pauseNewsletterSendingDomainIfUnhealthy } from "./newsletter-sending-domain-warmup.service";

const m = vi.hoisted(() => ({
  find: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    newsletterSendingDomain: { findUnique: m.find, updateMany: m.update },
    newsletterSend: { count: m.count },
  },
}));
const NOW = new Date("2026-10-29T14:00:00Z");
const DOMAIN = {
  id: "domain_1",
  status: "VERIFIED",
  warmupStartedAt: new Date("2026-10-27T23:00:00Z"),
  warmupPausedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  m.find.mockResolvedValue(DOMAIN);
  m.count.mockResolvedValue(0);
});

describe("pauseNewsletterSendingDomainIfUnhealthy", () => {
  it.each([
    null,
    { ...DOMAIN, status: "PENDING" },
    { ...DOMAIN, warmupStartedAt: null },
    { ...DOMAIN, warmupPausedAt: NOW },
  ])("skips a domain that cannot warm up: %j", async (domain) => {
    m.find.mockResolvedValue(domain);
    await pauseNewsletterSendingDomainIfUnhealthy(DOMAIN.id, NOW);
    expect(m.count).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("pauses above the hard-bounce threshold with a sufficient sample", async () => {
    m.count
      .mockResolvedValueOnce(50)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(0);
    await pauseNewsletterSendingDomainIfUnhealthy(DOMAIN.id, NOW);
    expect(m.update).toHaveBeenCalledWith({
      where: {
        id: DOMAIN.id,
        status: "VERIFIED",
        warmupStartedAt: DOMAIN.warmupStartedAt,
        warmupPausedAt: null,
      },
      data: { warmupPausedAt: NOW, warmupPauseReason: "BOUNCE_RATE" },
    });
    expect(m.count).toHaveBeenNthCalledWith(2, {
      where: {
        sendingDomainId: DOMAIN.id,
        attemptedAt: { gte: DOMAIN.warmupStartedAt, lte: NOW },
        events: {
          some: {
            type: "BOUNCED",
            bounceType: { in: ["permanent", "hard"] },
            occurredAt: { gte: DOMAIN.warmupStartedAt, lte: NOW },
          },
        },
      },
    });
  });

  it("pauses for complaints, counting each send once even with repeated events", async () => {
    m.count
      .mockResolvedValueOnce(50)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    await pauseNewsletterSendingDomainIfUnhealthy(DOMAIN.id, NOW);
    expect(m.update.mock.calls[0]?.[0].data.warmupPauseReason).toBe(
      "COMPLAINT_RATE",
    );
    expect(m.count.mock.calls[2]?.[0].where.events).toEqual({
      some: {
        type: "COMPLAINED",
        occurredAt: { gte: DOMAIN.warmupStartedAt, lte: NOW },
      },
    });
  });

  it.each([
    [49, 3, 1],
    [50, 2, 0],
    [1000, 0, 1],
  ])(
    "does not pause for attempts=%s hard bounces=%s complaints=%s",
    async (attempted, bounced, complained) => {
      m.count
        .mockResolvedValueOnce(attempted)
        .mockResolvedValueOnce(bounced)
        .mockResolvedValueOnce(complained);
      await pauseNewsletterSendingDomainIfUnhealthy(DOMAIN.id, NOW);
      expect(m.update).not.toHaveBeenCalled();
    },
  );

  it("limits an older ramp to the last seven days", async () => {
    m.find.mockResolvedValue({
      ...DOMAIN,
      warmupStartedAt: new Date("2026-10-01T00:00:00Z"),
    });
    await pauseNewsletterSendingDomainIfUnhealthy(DOMAIN.id, NOW);
    expect(m.count).toHaveBeenNthCalledWith(1, {
      where: {
        sendingDomainId: DOMAIN.id,
        attemptedAt: { gte: new Date("2026-10-22T14:00:00Z"), lte: NOW },
      },
    });
  });
});
