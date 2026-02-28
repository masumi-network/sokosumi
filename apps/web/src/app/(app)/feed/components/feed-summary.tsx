import { Card, CardContent } from "@/components/ui/card";

interface FeedSummaryProps {
  summary: string;
  bullets: string[];
}

export function FeedSummary({ summary, bullets }: FeedSummaryProps) {
  return (
    <Card className="dark:bg-card-background overflow-hidden bg-neutral-950 p-0 text-white">
      <CardContent className="p-0">
        <div className="grid h-full gap-6 p-6 md:grid-cols-[220px_1fr] md:gap-0 md:p-0">
          {/* left column */}
          <div className="flex flex-col justify-between md:border-r md:border-white/10 md:p-8">
            <p className="font-medium tracking-wider text-white/40 uppercase">
              {summary}
            </p>
          </div>
          <div className="p-6">
            <ul className="list-disc space-y-4 pl-5 text-sm">
              {bullets.map((bullet, index) => (
                <li key={`${index}-${bullet}`}>{bullet}</li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
