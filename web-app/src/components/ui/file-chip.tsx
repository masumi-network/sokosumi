import Image from "next/image";

import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils/format-bytes";
import { getExtensionFromUrl, isImageUrl } from "@/lib/utils/file";

export interface FileChipProps extends React.ComponentPropsWithoutRef<"a"> {
  url: string;
  fileName?: string | null;
  size?: number | bigint | null;
}

export function FileChip(props: FileChipProps) {
  const {
    url,
    fileName: fileNameProp,
    size,
    className,
    ...anchorProps
  } = props;
  const fileName = fileNameProp ?? url.split("/").pop() ?? url;
  const isImage = isImageUrl(url);
  const prettySize = formatBytes(size);

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
      <div className="bg-accent/50 relative size-10 shrink-0 overflow-hidden rounded border">
        {isImage ? (
          <Image
            src={url}
            alt={fileName}
            fill
            sizes="40px"
            className="object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <span className="text-muted-foreground text-xs uppercase">
              {getExtensionFromUrl(url) || "file"}
            </span>
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
