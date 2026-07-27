import { ssrfSafeFetch } from "@sokosumi/net";
import { isDesignMdBlobUrl } from "@sokosumi/utils";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/** Match Core `LIMITS.DESIGN_MD_MAX_SIZE_BYTES` — editor content cap. */
const MAX_DESIGN_MD_FETCH_BYTES = 1024 * 1024;

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

/**
 * Loads DESIGN.md markdown for the editor.
 *
 * Only fetches Core-uploaded Vercel Blob URLs under `/design-md/` via
 * {@link ssrfSafeFetch}. Client-writable metadata must not be able to point
 * this at internal or metadata endpoints (SSRF).
 */
async function fetchDesignMdMarkdown(
  designMdUrl: string,
): Promise<{ markdown: string } | { error: true }> {
  if (!isDesignMdBlobUrl(designMdUrl)) {
    return { error: true };
  }

  try {
    const response = await ssrfSafeFetch(designMdUrl, {
      maxResponseBytes: MAX_DESIGN_MD_FETCH_BYTES,
    });

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
