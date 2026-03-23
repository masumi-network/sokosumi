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
