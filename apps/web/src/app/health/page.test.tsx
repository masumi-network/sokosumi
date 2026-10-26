import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => undefined }));

import HealthPage from "./page";

describe("HealthPage", () => {
  it("answers ok", async () => {
    render(await HealthPage());
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
