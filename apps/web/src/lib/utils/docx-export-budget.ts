import { ExportLimitError } from "@/lib/utils/export-operation";

export const MAX_DOCX_IMAGES = 20;
export const MAX_DOCX_REMOTE_IMAGE_BYTES = 20_000_000;

interface DocumentNode {
  type: string;
  value?: string;
  children?: DocumentNode[];
}

/** Count occurrences before the image plugin starts parallel image resolution. */
export function assertDocxImageCount(
  root: DocumentNode,
  headerImages: number,
): void {
  let count = headerImages;
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) break;
    if (
      node.type === "image" ||
      node.type === "imageReference" ||
      node.type === "svg"
    ) {
      count += 1;
    } else if (node.type === "html") {
      // Count conservatively without rendering untrusted HTML. This includes
      // commented image tags; the HTML plugin runs after the image plugin.
      count += node.value?.match(/<(?:img|svg)\b/gi)?.length ?? 0;
    }
    if (count > MAX_DOCX_IMAGES) {
      throw new ExportLimitError("DOCX image count exceeds limit");
    }
    if (node.children) pending.push(...node.children);
  }
}
