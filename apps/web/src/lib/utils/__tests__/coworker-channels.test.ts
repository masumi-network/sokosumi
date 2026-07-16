import { Channel } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import type { Coworker } from "@/lib/clients/generated/core";
import { mockCoreCoworker } from "@/test-fixtures/coworker";

import { getCoworkerMetadataChannels } from "../coworker-channels";

function baseCoworker(overrides: Partial<Coworker> = {}): Coworker {
  return mockCoreCoworker(overrides);
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
      { channel: Channel.EMAIL, value: "ops@example.com" },
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
      { channel: Channel.WHATSAPP, value: "+49151xxxx" },
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
      { channel: Channel.EMAIL, value: "primary@example.com" },
      { channel: Channel.WHATSAPP, value: "+49" },
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
    expect(channels).toEqual([{ channel: Channel.TELEGRAM, value: "@ops" }]);
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
        channel: Channel.TEAMS,
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
      { channel: Channel.DISCORD, value: "user#1234" },
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
      { channel: Channel.EMAIL, value: "e@x.com" },
      { channel: Channel.WHATSAPP, value: "w" },
      { channel: Channel.TELEGRAM, value: "tg" },
      { channel: Channel.TEAMS, value: "t" },
      { channel: Channel.DISCORD, value: "d" },
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
