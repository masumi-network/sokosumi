import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { renderOrganizationChatList } from "./organization-chat-list-harness";

it("offers a visible compose action when Direct messages is empty", () => {
  renderOrganizationChatList({ rooms: [] });
  expect(screen.getByRole("button", { name: /messageSomeone/ })).toBeVisible();
});
