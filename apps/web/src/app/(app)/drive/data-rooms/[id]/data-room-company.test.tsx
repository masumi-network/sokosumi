import type { DataRoom } from "@sokosumi/core-client";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  updateDataRoom: vi.fn().mockResolvedValue({}),
  dataRoomRefusal: () => null,
}));
vi.mock("@/lib/utils/data-room.client", () => api);
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DataRoomCompanyPanel } from "./data-room-company";

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
    render(
      <DataRoomCompanyPanel
        store={store}
        room={room}
        rows={[]}
        onChanged={onChanged}
      />,
    );
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
    expect(onChanged).toHaveBeenCalled();
  });

  it("removes the Company page when the legal name is cleared", async () => {
    render(
      <DataRoomCompanyPanel
        store={store}
        room={room}
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
