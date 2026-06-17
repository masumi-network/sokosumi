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
}

export function CoreAuthReadRetry({
  description,
  retryLabel,
  title,
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
          onClick={() => startTransition(() => router.refresh())}
        >
          {retryLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
