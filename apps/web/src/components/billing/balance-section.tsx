import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface BalanceSectionProps {
  creditsLabel: string;
  description: string;
  title: string;
}

export function BalanceSection({
  creditsLabel,
  description,
  title,
}: BalanceSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{creditsLabel}</p>
      </CardContent>
    </Card>
  );
}
