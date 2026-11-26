import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import HeaderProfileSection from "./header-profile-section";

vi.mock("@/app/components/header/header-trailing-tools", () => ({
  HeaderTrailingTools: () => <button type="button">Notifications</button>,
}));

it("keeps notifications in trailing chrome while workspace controls live elsewhere", () => {
  render(<HeaderProfileSection />);
  expect(screen.getAllByRole("button")).toEqual([
    screen.getByRole("button", { name: "Notifications" }),
  ]);
});
