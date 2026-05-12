import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface OrganizationEnterprisePlanCardProps {
  contactSupportText: string;
  description: string;
  memberCount: number;
  membersLabel: string;
  seats: number;
  seatsLabel: string;
  title: string;
}

export function OrganizationEnterprisePlanCard({
  contactSupportText,
  description,
  memberCount,
  membersLabel,
  seats,
  seatsLabel,
  title,
}: OrganizationEnterprisePlanCardProps) {
  const summaryItems = [
    { label: seatsLabel, value: seats },
    { label: membersLabel, value: memberCount },
  ];

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-2">
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
        <p className="text-muted-foreground text-sm">{contactSupportText}</p>
      </CardContent>
    </Card>
  );
}
