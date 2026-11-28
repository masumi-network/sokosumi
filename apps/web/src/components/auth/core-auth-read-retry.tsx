"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface CoreAuthReadRetryProps {
  description: string;
  retryLabel: string;
  title: string;
  /** A client read retries itself; a server read refreshes the route. */
  onRetry?: () => unknown;
  retrying?: boolean;
}

export function CoreAuthReadRetry({
  description,
  retryLabel,
  title,
  onRetry,
  retrying = false,
}: CoreAuthReadRetryProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          loading={retrying}
          onClick={() =>
            onRetry ? onRetry() : startTransition(() => router.refresh())
          }
        >
          {retryLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
