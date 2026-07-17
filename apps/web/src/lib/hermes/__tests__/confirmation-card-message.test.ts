import { describe, expect, it } from "vitest";

import { parseConfirmationCardMessage } from "@/lib/hermes/confirmation-card-message";

const VALID_CARD = {
  confirmationId: "conf_1",
  toolName: "sokosumi_create_task",
  summary: "Create task 'Weekly report' and assign it to Alex.",
  status: "approved",
  organizationId: "org_nmkr",
  organizationName: "NMKR",
  referencedCoworkers: [
    { id: "cw_1", name: "Alex", image: "https://img.example/alex.png" },
  ],
  referencedOrganizations: [{ id: "org_nmkr", name: "NMKR", slug: "nmkr" }],
  confirmationCreatedAt: "2026-07-17T12:00:00.000Z",
};

describe("parseConfirmationCardMessage", () => {
  it("parses a full snapshot back into confirmation + resolution", () => {
    const parsed = parseConfirmationCardMessage(JSON.stringify(VALID_CARD));

    expect(parsed).toEqual({
      confirmation: {
        id: "conf_1",
        toolName: "sokosumi_create_task",
        summary: "Create task 'Weekly report' and assign it to Alex.",
        createdAt: "2026-07-17T12:00:00.000Z",
        referencedCoworkers: [
          { id: "cw_1", name: "Alex", image: "https://img.example/alex.png" },
        ],
        referencedOrganizations: [
          { id: "org_nmkr", name: "NMKR", slug: "nmkr" },
        ],
        organizationId: "org_nmkr",
        organizationName: "NMKR",
      },
      resolution: { status: "approved", organizationId: "org_nmkr" },
    });
  });

  it("parses a rejected personal-scope card with missing optional fields", () => {
    const parsed = parseConfirmationCardMessage(
      JSON.stringify({
        confirmationId: "conf_2",
        toolName: "sokosumi_create_job",
        summary: "Hire the Research agent.",
        status: "rejected",
        organizationId: null,
        organizationName: null,
      }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.resolution).toEqual({
      status: "rejected",
      organizationId: null,
    });
    expect(parsed?.confirmation.referencedCoworkers).toEqual([]);
    expect(parsed?.confirmation.referencedOrganizations).toEqual([]);
  });

  it("drops malformed referenced entries instead of failing the whole card", () => {
    const parsed = parseConfirmationCardMessage(
      JSON.stringify({
        ...VALID_CARD,
        referencedCoworkers: [
          { id: "cw_1", name: "Alex", image: null },
          { id: 42, name: "broken" },
          "not-an-object",
        ],
      }),
    );

    expect(parsed?.confirmation.referencedCoworkers).toEqual([
      { id: "cw_1", name: "Alex", image: null },
    ]);
  });

  it.each([
    ["not json at all", "plain text"],
    ["a JSON scalar", JSON.stringify("hello")],
    [
      "missing confirmationId",
      JSON.stringify({ ...VALID_CARD, confirmationId: undefined }),
    ],
    ["empty toolName", JSON.stringify({ ...VALID_CARD, toolName: "" })],
    [
      "an unexpected status",
      JSON.stringify({ ...VALID_CARD, status: "already_resolved" }),
    ],
  ])("returns null for %s", (_label, content) => {
    expect(parseConfirmationCardMessage(content)).toBeNull();
  });
});
