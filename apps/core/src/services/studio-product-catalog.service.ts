import { createHash } from "node:crypto";

import { extensionForEntityImageMime } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { serviceUnavailable, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { downloadRemoteImage } from "@/lib/remote-image";
import { studioProductCatalogSchema } from "@/schemas/studio-product.schema";
import { writeStudioDriveFile } from "@/services/image-studio-drive.service";

export async function readStudioProductCatalog(projectId: string) {
  const catalog = await prisma.projectStudioProductCatalog.findUnique({
    where: { projectId },
    select: { products: true, revision: true },
  });
  return studioProductCatalogSchema.parse(
    catalog ?? { products: [], revision: 0 },
  );
}

export async function copyRemoteStudioProductPhoto({
  imageUrl,
  name,
  ...scope
}: {
  imageUrl: string;
  name: string;
  workspaceId: string;
  organizationId: string | null;
  userId: string;
}) {
  const photo = await downloadRemoteImage(imageUrl, {
    timeoutMs: 8_000,
    maxBytes: LIMITS.IMAGE_STUDIO_MAX_REFERENCE_BYTES,
    isAllowedContentType: (mime) =>
      mime === "image/jpeg" || mime === "image/png" || mime === "image/webp",
  });
  const extension = photo
    ? extensionForEntityImageMime(photo.contentType)
    : null;
  if (!photo || !extension) {
    throw unprocessableEntity(
      "Could not read a supported product photo at that URL.",
    );
  }

  const bytes = new Uint8Array(photo.bytes);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const file = await writeStudioDriveFile({
    ...scope,
    name: `product-photo-${hash}.${extension}`,
    bytes,
    contentType: photo.contentType,
  });
  if (!file) throw serviceUnavailable("Could not save the product photo.");
  return { id: file.id, name };
}
