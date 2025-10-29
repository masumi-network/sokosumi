import Image from "next/image";

import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils/format-bytes";
import { getExtensionFromUrl, isImageUrl } from "@/lib/utils/file";
import { FileTypeIcon } from "@/components/ui/file-icon";

export interface FileChipProps extends React.ComponentPropsWithoutRef<"a"> {
  url: string;
  fileName?: string | null;
  size?: number | bigint | null;
  /**
   * Tailwind size class (e.g., `size-8`, `size-10`). Defaults to `size-10`.
   */
  sizeClass?: string;
  /**
   * Approximate pixel size of the icon/thumbnail for layout hints.
   * Used for next/image `sizes` attribute. Defaults to 40.
   */
  iconPx?: number;
}

export function FileChip(props: FileChipProps) {
  const {
    url,
    fileName: fileNameProp,
    size,
    className,
    sizeClass = "size-10",
    iconPx = 40,
    ...anchorProps
  } = props;
  const fileName = fileNameProp ?? url.split("/").pop() ?? url;
  const isImage = isImageUrl(url);
  const prettySize = formatBytes(size);
  const containerSizeClass = sizeClass;
  const shouldApplyIconPadding = (() => {
    const match = containerSizeClass.match(/size-(\d+)/);
    const numeric = match ? Number(match[1]) : NaN;
    return Number.isFinite(numeric) && numeric > 6;
  })();

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      {...anchorProps}
      className={cn(
        "hover:bg-accent focus-visible:ring-ring inline-flex w-full max-w-full items-center gap-3 rounded-md border p-2 transition outline-none",
        className,
      )}
    >
      <div
        className={cn(
          "bg-accent/50 relative shrink-0 rounded",
          containerSizeClass,
        )}
      >
        {isImage ? (
          <div className="relative size-full overflow-hidden rounded">
            <Image
              src={url}
              alt={fileName}
              fill
              sizes={`${iconPx}px`}
              className="object-cover"
            />
          </div>
        ) : (
          <div className={cn("flex size-full items-center justify-center", shouldApplyIconPadding && "p-1")}>
            {(() => {
              const ext = getExtensionFromUrl(url) || "file";
              return <FileTypeIcon extension={ext} />;
            })()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{fileName}</div>
        {prettySize && (
          <div className="text-muted-foreground truncate text-xs">
            {prettySize}
          </div>
        )}
      </div>
    </a>
  );
}
