import Link from "next/link";

import { Button } from "@/components/ui/button";

interface DesignMdLoadErrorProps {
  backHref: string;
  backLabel: string;
  description: string;
  title: string;
}

export function DesignMdLoadError({
  backHref,
  backLabel,
  description,
  title,
}: DesignMdLoadErrorProps) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="space-y-2">
        <h1 className="font-semibold text-lg">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <Button asChild variant="outline">
        <Link href={backHref}>{backLabel}</Link>
      </Button>
    </div>
  );
}

async function fetchDesignMdMarkdown(
  designMdUrl: string,
): Promise<{ markdown: string } | { error: true }> {
  try {
    const response = await fetch(designMdUrl, { cache: "no-store" });

    if (!response.ok) {
      return { error: true };
    }

    const markdown = await response.text();
    return { markdown };
  } catch {
    return { error: true };
  }
}

export { fetchDesignMdMarkdown };
