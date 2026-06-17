import { TaskEventOrigin } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import type { Coworker } from "@/lib/clients/generated/core";

import { getCoworkerMetadataChannels } from "../coworker-channels";

function baseCoworker(overrides: Partial<Coworker> = {}): Coworker {
  return {
    id: "cow_1",
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    isWhitelisted: true,
    priority: 0,
    slug: "ops-agent",
    name: "Ops Agent",
    baseURL: null,
    capabilities: ["tasks"],
    metadata: null,
    ...overrides,
  };
}

describe("getCoworkerMetadataChannels", () => {
  it("builds email channel from metadata.channels", () => {
    const channels = getCoworkerMetadataChannels(
      baseCoworker({
        metadata: {
          channels: { email: "ops@example.com" },
        },
      }),
    );
    expect(channels).toEqual([
      { origin: TaskEventOrigin.EMAIL, value: "ops@example.com" },
    ]);
  });

  it("builds WhatsApp channel from metadata.channels", () => {
    const channels = getCoworkerMetadataChannels(
      baseCoworker({
        metadata: {
          channels: { whatsapp: "+49151xxxx" },
        },
      }),
    );
    expect(channels).toEqual([
      { origin: TaskEventOrigin.WHATSAPP, value: "+49151xxxx" },
    ]);
  });

  it("includes email and WhatsApp channels together", () => {
    const channels = getCoworkerMetadataChannels(
      baseCoworker({
        metadata: {
          channels: {
            email: "primary@example.com",
            whatsapp: "+49",
          },
        },
      }),
    );
    expect(channels).toEqual([
      { origin: TaskEventOrigin.EMAIL, value: "primary@example.com" },
      { origin: TaskEventOrigin.WHATSAPP, value: "+49" },
    ]);
  });

  it("builds Telegram channel from metadata.channels", () => {
    const channels = getCoworkerMetadataChannels(
      baseCoworker({
        metadata: {
          channels: { telegram: "@ops" },
        },
      }),
    );
    expect(channels).toEqual([
      { origin: TaskEventOrigin.TELEGRAM, value: "@ops" },
    ]);
  });

  it("builds Teams channel from metadata.channels", () => {
    const channels = getCoworkerMetadataChannels(
      baseCoworker({
        metadata: {
          channels: { teams: "https://teams.microsoft.com/l/chat/0/0" },
        },
      }),
    );
    expect(channels).toEqual([
      {
        origin: TaskEventOrigin.TEAMS,
        value: "https://teams.microsoft.com/l/chat/0/0",
      },
    ]);
  });

  it("builds Discord channel from metadata.channels", () => {
    const channels = getCoworkerMetadataChannels(
      baseCoworker({
        metadata: {
          channels: { discord: "user#1234" },
        },
      }),
    );
    expect(channels).toEqual([
      { origin: TaskEventOrigin.DISCORD, value: "user#1234" },
    ]);
  });

  it("orders channels email, WhatsApp, Telegram, Teams, Discord", () => {
    const channels = getCoworkerMetadataChannels(
      baseCoworker({
        metadata: {
          channels: {
            discord: "d",
            teams: "t",
            telegram: "tg",
            whatsapp: "w",
            email: "e@x.com",
          },
        },
      }),
    );
    expect(channels).toEqual([
      { origin: TaskEventOrigin.EMAIL, value: "e@x.com" },
      { origin: TaskEventOrigin.WHATSAPP, value: "w" },
      { origin: TaskEventOrigin.TELEGRAM, value: "tg" },
      { origin: TaskEventOrigin.TEAMS, value: "t" },
      { origin: TaskEventOrigin.DISCORD, value: "d" },
    ]);
  });

  it("ignores blank channels values", () => {
    const channels = getCoworkerMetadataChannels(
      baseCoworker({
        metadata: {
          channels: { email: "   ", whatsapp: " " },
        },
      }),
    );
    expect(channels).toEqual([]);
  });
});
