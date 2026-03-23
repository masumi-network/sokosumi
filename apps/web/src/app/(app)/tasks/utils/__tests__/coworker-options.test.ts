import { TaskEventOrigin } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import type { Coworker } from "@/lib/clients/generated/core";

import { getCoworkerOptions } from "../coworker-options";

function baseCoworker(overrides: Partial<Coworker> = {}): Coworker {
  return {
    id: "cow_1",
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    isWhitelisted: true,
    slug: "ops-agent",
    name: "Ops Agent",
    baseURL: null,
    capabilities: ["tasks"],
    metadata: null,
    ...overrides,
  };
}

describe("getCoworkerOptions", () => {
  it("builds email contact from metadata.channels", () => {
    const options = getCoworkerOptions([
      baseCoworker({
        metadata: {
          channels: { email: "ops@example.com" },
        },
      }),
    ]);
    expect(options[0]?.contacts).toEqual([
      { origin: TaskEventOrigin.EMAIL, value: "ops@example.com" },
    ]);
  });

  it("builds WhatsApp contact from metadata.channels", () => {
    const options = getCoworkerOptions([
      baseCoworker({
        metadata: {
          channels: { whatsapp: "+49151xxxx" },
        },
      }),
    ]);
    expect(options[0]?.contacts).toEqual([
      { origin: TaskEventOrigin.WHATSAPP, value: "+49151xxxx" },
    ]);
  });

  it("includes email and WhatsApp channels together", () => {
    const options = getCoworkerOptions([
      baseCoworker({
        metadata: {
          channels: {
            email: "primary@example.com",
            whatsapp: "+49",
          },
        },
      }),
    ]);
    expect(options[0]?.contacts).toEqual([
      { origin: TaskEventOrigin.EMAIL, value: "primary@example.com" },
      { origin: TaskEventOrigin.WHATSAPP, value: "+49" },
    ]);
  });

  it("builds Telegram contact from metadata.channels", () => {
    const options = getCoworkerOptions([
      baseCoworker({
        metadata: {
          channels: { telegram: "@ops" },
        },
      }),
    ]);
    expect(options[0]?.contacts).toEqual([
      { origin: TaskEventOrigin.TELEGRAM, value: "@ops" },
    ]);
  });

  it("builds Teams contact from metadata.channels", () => {
    const options = getCoworkerOptions([
      baseCoworker({
        metadata: {
          channels: { teams: "https://teams.microsoft.com/l/chat/0/0" },
        },
      }),
    ]);
    expect(options[0]?.contacts).toEqual([
      {
        origin: TaskEventOrigin.TEAMS,
        value: "https://teams.microsoft.com/l/chat/0/0",
      },
    ]);
  });

  it("builds Discord contact from metadata.channels", () => {
    const options = getCoworkerOptions([
      baseCoworker({
        metadata: {
          channels: { discord: "user#1234" },
        },
      }),
    ]);
    expect(options[0]?.contacts).toEqual([
      { origin: TaskEventOrigin.DISCORD, value: "user#1234" },
    ]);
  });

  it("orders contacts email, WhatsApp, Telegram, Teams, Discord", () => {
    const options = getCoworkerOptions([
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
    ]);
    expect(options[0]?.contacts).toEqual([
      { origin: TaskEventOrigin.EMAIL, value: "e@x.com" },
      { origin: TaskEventOrigin.WHATSAPP, value: "w" },
      { origin: TaskEventOrigin.TELEGRAM, value: "tg" },
      { origin: TaskEventOrigin.TEAMS, value: "t" },
      { origin: TaskEventOrigin.DISCORD, value: "d" },
    ]);
  });

  it("ignores blank channels values", () => {
    const options = getCoworkerOptions([
      baseCoworker({
        metadata: {
          channels: { email: "   ", whatsapp: " " },
        },
      }),
    ]);
    expect(options[0]?.contacts).toEqual([]);
  });
});
