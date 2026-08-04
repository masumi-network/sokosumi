import { FileIcon } from "lucide-react";

import { FileChipWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { Favicon } from "@/components/ui/favicon";
import { BlobStatus } from "@/lib/clients/generated/core";
import { getBlobUrl } from "@/lib/helpers/blob";
import { cn } from "@/lib/utils";
import { buildFaviconCandidates, getHostname } from "@/lib/utils/url";

import { BlobStatusBadge } from "./blob-status-badge";

export interface BlobLike {
  id: string;
  sourceUrl: string;
  status: BlobStatus;
  name?: string | null;
  fileUrl?: string | null;
}

export interface LinkLike {
  id: string;
  url: string;
  title?: string | null;
}

export interface SourcesGridProps {
  title: string;
  blobs?: BlobLike[];
  links?: LinkLike[];
  className?: string;
}

export function SourcesGrid(props: SourcesGridProps) {
  const { title, blobs = [], links = [], className } = props;

  return (
    <div className={cn("mt-2", className)}>
      <h3 className="text-foreground/80 mb-1 text-sm font-semibold">{title}</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
        {blobs.map((blob) => (
          <FileItemChip key={blob.id} blob={blob} />
        ))}
        {links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:bg-accent focus-visible:ring-ring inline-flex w-full max-w-full items-center gap-3 rounded-md border p-2 transition outline-none"
          >
            <div className="bg-accent/50 relative size-4 shrink-0 items-center justify-center overflow-hidden rounded">
              <Favicon
                sources={buildFaviconCandidates(link.url)}
                alt={link.title ?? link.url}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {link.title ?? getHostname(link.url) ?? link.url}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function FileItemChip({ blob }: { blob: BlobLike }) {
  if (blob.status !== BlobStatus.READY) {
    return (
      <div className="inline-flex items-center gap-2 rounded-md border p-2">
        <div className="inline-flex items-center justify-center">
          <FileIcon className="text-muted-foreground size-4" />
        </div>
        <span className="text-foreground/80 w-full truncate text-sm">
          {blob.name ?? getBlobUrl(blob)}
        </span>
        <div className="inline-flex justify-end">
          <BlobStatusBadge status={blob.status} />
        </div>
      </div>
    );
  }

  return (
    <FileChipWithMetadata
      url={getBlobUrl(blob)}
      fileName={blob.name}
      sizeClass="size-4"
    />
  );
}
