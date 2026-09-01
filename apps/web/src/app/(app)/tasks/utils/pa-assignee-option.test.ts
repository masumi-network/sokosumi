import { describe, expect, it } from "vitest";

import type { CoworkerOption } from "@/lib/types/coworker";

import {
  buildPaAssigneeOption,
  resolveAssigneeWriteFields,
  resolveDefaultAssigneePickerId,
} from "./pa-assignee-option";

function mockCoworkerOption(
  overrides: Partial<CoworkerOption> & Pick<CoworkerOption, "id" | "name">,
): CoworkerOption {
  return {
    slug: overrides.name.toLowerCase(),
    image: "",
    vendor: {
      id: "vendor-1",
      name: "Vendor",
      slug: "vendor",
      logos: { light: null, dark: null },
    },
    priority: 0,
    ...overrides,
  };
}

describe("resolveDefaultAssigneePickerId", () => {
  const paAssigneeOption = buildPaAssigneeOption({
    id: "01960001-0001-7001-8001-000000000099",
    name: "Ada",
  } as never);

  const coworkerOptions = [
    mockCoworkerOption({ id: "coworker-1", slug: "soko", name: "Soko" }),
    mockCoworkerOption({
      id: "coworker-2",
      slug: "elena",
      name: "Elena",
      priority: 0,
    }),
  ];

  it("prefers Elena over the PA when both are available", () => {
    expect(
      resolveDefaultAssigneePickerId({
        coworkerOptions,
        paAssigneeOption,
        assigneePickerOptions: [paAssigneeOption!, ...coworkerOptions],
      }),
    ).toBe("coworker-2");
  });

  it("uses the highest-priority coworker before the PA when Elena is absent", () => {
    const serviceplan = mockCoworkerOption({
      id: "coworker-sp",
      slug: "serviceplan",
      name: "Serviceplan",
      priority: 10,
    });

    expect(
      resolveDefaultAssigneePickerId({
        coworkerOptions: [serviceplan],
        paAssigneeOption,
        assigneePickerOptions: [paAssigneeOption!, serviceplan],
      }),
    ).toBe("coworker-sp");
  });

  it("falls back to the PA when no marketplace coworkers exist", () => {
    expect(
      resolveDefaultAssigneePickerId({
        coworkerOptions: [],
        paAssigneeOption,
        assigneePickerOptions: [paAssigneeOption!],
      }),
    ).toBe(paAssigneeOption!.id);
  });

  it("honors an orchestrator assignee from initial values", () => {
    expect(
      resolveDefaultAssigneePickerId({
        initialValues: {
          assigneeOrchestratorId: "01960001-0001-7001-8001-000000000099",
        },
        coworkerOptions,
        paAssigneeOption,
        assigneePickerOptions: [paAssigneeOption!, ...coworkerOptions],
      }),
    ).toBe("orchestrator:01960001-0001-7001-8001-000000000099");
  });
});

describe("resolveAssigneeWriteFields", () => {
  it("maps PA picker ids to orchestrator-only writes", () => {
    expect(
      resolveAssigneeWriteFields(
        "orchestrator:01960001-0001-7001-8001-000000000099",
      ),
    ).toEqual({
      assigneeId: null,
      assigneeOrchestratorId: "01960001-0001-7001-8001-000000000099",
    });
  });
});
