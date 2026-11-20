import { describe, expect, it } from "vitest";

import {
  cleanDataRoomCompany,
  dataRoomCompanySchema,
  readDataRoomCompany,
} from "./data-room-company.schema";

describe("data room company details", () => {
  it("stores only filled fields, a representative only with a name", () => {
    const input = dataRoomCompanySchema.parse({
      legalName: "  Sumico, Inc. ",
      legalForm: "Corporation",
      vatId: "",
      euRepresentative: {
        name: "Phil Isenmann",
        email: "phil@utxoag.com",
        address: "",
      },
      ukRepresentative: { name: "", email: "" },
      websites: ["www.cmo.xyz", ""],
      formationPath: "/Legal//Formation/",
    });

    expect(cleanDataRoomCompany(input)).toEqual({
      legalName: "Sumico, Inc.",
      legalForm: "Corporation",
      euRepresentative: { name: "Phil Isenmann", email: "phil@utxoag.com" },
      websites: ["www.cmo.xyz"],
      formationPath: "Legal/Formation",
    });
  });

  it("refuses details without a legal name", () => {
    expect(dataRoomCompanySchema.safeParse({ legalName: " " }).success).toBe(
      false,
    );
  });

  it("reads nothing from an empty or unreadable column", () => {
    expect(readDataRoomCompany(null)).toBeNull();
    expect(readDataRoomCompany({ legalForm: "Corporation" })).toBeNull();
    expect(readDataRoomCompany({ legalName: "Sumico, Inc." })).toEqual({
      legalName: "Sumico, Inc.",
    });
  });
});
