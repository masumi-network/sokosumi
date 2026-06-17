"use client";

import { useRouter } from "next/navigation";

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
          onClick={() => router.refresh()}
        >
          {retryLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
