"use client";

import { Button } from "@/components/ui/button";

interface LoadingButtonDemoProps {
  label: string;
}

/** A busy primary button. `loading` attaches a click guard, so it renders here. */
export function LoadingButtonDemo({ label }: LoadingButtonDemoProps) {
  return (
    <Button variant="primary" loading>
      {label}
    </Button>
  );
}
