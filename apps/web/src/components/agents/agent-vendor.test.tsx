import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentVendor } from "./agent-vendor";

describe("AgentVendor", () => {
  it("shows the name when the logo cannot load, so the author line is never empty", () => {
    render(
      <AgentVendor
        logo="https://c-ipfs-gw.nmkr.io/ipfs/missing"
        label="by Nuauth"
        alt="Logo of the company behind Knight"
        size="sm"
      />,
    );

    fireEvent.error(screen.getByAltText("Logo of the company behind Knight"));

    expect(screen.getByText("by Nuauth")).toBeInTheDocument();
    expect(
      screen.queryByAltText("Logo of the company behind Knight"),
    ).not.toBeInTheDocument();
  });
});
