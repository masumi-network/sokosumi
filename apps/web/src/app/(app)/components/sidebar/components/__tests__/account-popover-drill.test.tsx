import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountPopoverDrill } from "@/app/components/sidebar/components/account-popover-drill.client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("AccountPopoverDrill legal panel", () => {
  it("reopens cookie preferences from the live Legal drill", () => {
    const onOpenConsent = vi.fn();

    render(
      <AccountPopoverDrill
        panel={{ kind: "legal" }}
        members={[]}
        activeOrganizationId={null}
        showDeveloperVendors={false}
        onNavigatePanel={vi.fn()}
        onNavigateRoute={vi.fn()}
        onOpenExternal={vi.fn()}
        onOpenConsent={onOpenConsent}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(onOpenConsent).toHaveBeenCalledTimes(1);
  });
});
