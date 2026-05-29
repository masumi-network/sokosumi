import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { OrganizationSeatSummary } from "@/lib/services/organization-seat.service";

interface OrganizationSeatSummaryCardProps {
  seatSummary: OrganizationSeatSummary;
}

export async function OrganizationSeatSummaryCard({
  seatSummary,
}: OrganizationSeatSummaryCardProps) {
  const t = await getTranslations("App.Organizations.OrganizationDetail.Seats");

  const summaryItems = [
    { label: t("purchased"), value: seatSummary.purchasedSeats },
    { label: t("assigned"), value: seatSummary.assignedCount },
    { label: t("unused"), value: seatSummary.unusedSeats },
  ];

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-3">
          {summaryItems.map((item) => (
            <div key={item.label} className="space-y-1">
              <dt className="text-muted-foreground text-xs font-medium">
                {item.label}
              </dt>
              <dd className="text-2xl font-medium tabular-nums md:text-3xl">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
        <Button asChild variant="outline" size="sm">
          <Link href="/billing">{t("manageBilling")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
