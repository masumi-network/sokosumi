import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => {
  const translate = Object.assign(
    (key: string, values?: Record<string, unknown>) =>
      [key, ...Object.values(values ?? {})].join(" "),
    { raw: () => [] as string[] },
  );

  return {
    useTranslations: () => translate,
    useFormatter: () => ({ number: (value: number) => String(value) }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/aurora-orb", () => ({
  PlaceholderOrb: () => <div data-testid="orb" />,
}));

vi.mock("@/lib/actions/subscription", () => ({
  upgradePersonalSubscription: vi.fn(),
}));

import {
  SubscriptionRequiredDialog,
  type SubscriptionWallPlan,
} from "@/app/personal-assistant/components/subscription-required-dialog";

const PLANS: SubscriptionWallPlan[] = [
  { name: "standard", monthlyAmount: 75, currency: "eur", credits: 5000 },
  { name: "pro", monthlyAmount: 200, currency: "eur", credits: 15000 },
];

function renderDialog(
  overrides: Partial<
    React.ComponentProps<typeof SubscriptionRequiredDialog>
  > = {},
) {
  return render(
    <SubscriptionRequiredDialog
      open
      onOpenChange={vi.fn()}
      plans={PLANS}
      activeOrganizationId={null}
      {...overrides}
    />,
  );
}

describe("SubscriptionRequiredDialog", () => {
  it("offers only the plans that clear the assistant's floor", () => {
    renderDialog();

    expect(screen.getByText("Plans.standard.name")).toBeInTheDocument();
    expect(screen.getByText("Plans.pro.name")).toBeInTheDocument();
    expect(screen.queryByText("Plans.starter.name")).not.toBeInTheDocument();
    expect(screen.queryByText("Plans.free.name")).not.toBeInTheDocument();
  });

  it("says nothing about organization billing on a personal account", () => {
    renderDialog();

    expect(screen.queryByText(/organizationBilling/)).not.toBeInTheDocument();
  });

  it("names the organization that will be billed when billing is org-owned", () => {
    renderDialog({
      activeOrganizationId: "org_1",
      activeOrganizationName: "Acme Robotics",
    });

    expect(
      screen.getByText("organizationBilling Acme Robotics"),
    ).toBeInTheDocument();
  });

  it("still warns about organization billing when the name is unknown", () => {
    renderDialog({ activeOrganizationId: "org_1" });

    expect(screen.getByText("organizationBillingUnnamed")).toBeInTheDocument();
  });
});
