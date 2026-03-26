"use client";

import { useStreamingContent } from "@/app/chat/hooks/use-streaming-content";
import { Card, CardContent } from "@/components/ui/card";
import { SokosumiLoader } from "@/components/ui/sokosumi-loader";

interface FeedSummaryProps {
  title: string;
  summaryDescription: string;
  summary: string;
  bullets: string[];
  isGenerating: boolean;
  shouldAnimateStream: boolean;
  generatingLabel: string;
  errorLabel: string;
  hasError?: boolean;
}

export function FeedSummary({
  title,
  summaryDescription,
  summary,
  bullets,
  isGenerating,
  shouldAnimateStream,
  generatingLabel,
  errorLabel,
  hasError = false,
}: FeedSummaryProps) {
  const normalizedSummary = summary.trim();
  const hasSummary = normalizedSummary.length > 0;
  const streamedSummary = useStreamingContent(
    summary,
    shouldAnimateStream && hasSummary,
  );
  const isSummaryStreaming =
    shouldAnimateStream &&
    hasSummary &&
    streamedSummary.length < summary.length;
  const bulletStreamSource = isSummaryStreaming ? "" : bullets.join("\n");
  const streamedBullets = useStreamingContent(
    bulletStreamSource,
    shouldAnimateStream && !isSummaryStreaming && bullets.length > 0,
  );
  const visibleBullets = streamedBullets
    .split("\n")
    .map((bullet) => bullet.trim())
    .filter((bullet) => bullet.length > 0);

  return (
    <Card className="dark:bg-card-background overflow-hidden bg-neutral-950 bg-[url('/images/backgrounds/feed-bg.png')] bg-cover bg-center bg-no-repeat p-0 text-white">
      <CardContent className="p-0">
        <div className="grid h-full gap-6 p-4 md:grid-cols-[220px_1fr] md:gap-0 md:p-0">
          <div className="flex flex-col justify-start gap-4 md:border-r md:border-white/10 md:p-8">
            <h2 className="text-2xl font-bold">{title}</h2>
            <p className="text-xs font-medium tracking-wider text-white/40 uppercase">
              {summaryDescription}
            </p>
          </div>
          <div className="gap-6 p-0 md:p-6">
            {isGenerating ? (
              <div className="flex items-center gap-2">
                <SokosumiLoader className="size-6" />
                <span className="reasoning-text-shine text-sm leading-5">
                  {generatingLabel}
                </span>
              </div>
            ) : hasError ? (
              <p className="text-sm text-white/70">{errorLabel}</p>
            ) : (
              <div className="flex flex-col gap-4">
                <p className="text-sm font-medium tracking-wider">
                  {streamedSummary}
                </p>
                <ul className="list-disc space-y-4 pl-5 text-sm">
                  {visibleBullets.map((bullet, index) => (
                    <li key={`${index}-${bullet}`}>{bullet}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
