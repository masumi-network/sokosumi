import type { DataRoom } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  updateDataRoom: vi.fn().mockResolvedValue({}),
  dataRoomRefusal: () => null,
}));
vi.mock("@/lib/utils/data-room.client", () => api);
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { driveQueryKeys } from "@/queries/drive";
import { DataRoomCompanyPanel } from "./data-room-company";

function renderWithClient(ui: ReactNode, client = new QueryClient()) {
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}

const room = {
  id: "room_1",
  company: {
    legalName: "Sumico, Inc.",
    euRepresentative: { name: "Phil Isenmann" },
    websites: ["www.cmo.xyz"],
  },
} as DataRoom;
const store = { scope: "org", organizationId: "org_1" } as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DataRoomCompanyPanel", () => {
  it("saves the edited details with the room", async () => {
    const onChanged = vi.fn();
    const { client } = renderWithClient(
      <DataRoomCompanyPanel
        store={store}
        room={room}
        rows={[]}
        onChanged={onChanged}
      />,
    );
    client.setQueryData(driveQueryKeys.dataRoom(store, "room_1"), { room });
    expect(screen.getByLabelText("fields.legalName")).toHaveProperty(
      "value",
      "Sumico, Inc.",
    );

    await userEvent.type(
      screen.getByLabelText("fields.contactEmail"),
      "legal@sumico.io",
    );
    await userEvent.click(screen.getByRole("button", { name: "save" }));

    expect(api.updateDataRoom).toHaveBeenCalledWith({
      store,
      roomId: "room_1",
      settings: {
        company: expect.objectContaining({
          legalName: "Sumico, Inc.",
          contactEmail: "legal@sumico.io",
          euRepresentative: { name: "Phil Isenmann", email: "", address: "" },
          websites: ["www.cmo.xyz"],
          formationPath: undefined,
        }),
      },
    });
    expect(
      client.getQueryState(driveQueryKeys.dataRoom(store, "room_1"))
        ?.isInvalidated,
    ).toBe(true);
    expect(onChanged).toHaveBeenCalled();
  });

  it.each(["fields.contactEmail", "fields.eu.email", "fields.uk.email"])(
    "refuses to save a %s that is not an email address",
    async (label) => {
      renderWithClient(
        <DataRoomCompanyPanel
          store={store}
          room={room}
          rows={[]}
          onChanged={vi.fn()}
        />,
      );
      const field = screen.getByLabelText(label);
      await userEvent.type(field, "legal-at-sumico");
      await userEvent.click(screen.getByRole("button", { name: "save" }));

      expect(field).toBeInvalid();
      expect(api.updateDataRoom).not.toHaveBeenCalled();
    },
  );

  it("removes the Company page when the legal name is cleared, even with an old malformed email", async () => {
    const legacy = {
      ...room,
      company: {
        ...room.company,
        contactEmail: "legal-at-sumico",
        euRepresentative: { name: "Phil Isenmann", email: "phil at sumico" },
      },
    } as DataRoom;
    renderWithClient(
      <DataRoomCompanyPanel
        store={store}
        room={legacy}
        rows={[]}
        onChanged={vi.fn()}
      />,
    );
    await userEvent.clear(screen.getByLabelText("fields.legalName"));
    await userEvent.click(screen.getByRole("button", { name: "save" }));

    expect(api.updateDataRoom).toHaveBeenCalledWith(
      expect.objectContaining({ settings: { company: null } }),
    );
  });
});
