"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

interface ConsentRetryButtonProps {
  label: string;
}

export function ConsentRetryButton({ label }: ConsentRetryButtonProps) {
  const router = useRouter();

  return (
    <Button type="button" variant="outline" onClick={() => router.refresh()}>
      {label}
    </Button>
  );
}
