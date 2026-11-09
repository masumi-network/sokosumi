import type {
  StudioProduct,
  StudioProductPhoto,
  StudioWebsiteDraft,
} from "@sokosumi/core-client";
import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { prepareStudioWebsiteDraft } from "@/lib/actions/image-studio/brand-kit";

import type { StudioBatchProduct } from "./studio-batch";
import { StudioBrandKitDialog } from "./studio-brand-kit";
import { StudioProductCatalogDialog } from "./studio-product-catalog";

export function StudioWebsiteTools({
  canUseProduct,
  onLogoChange,
  onUseBatch,
  onUseProduct,
  projectId,
  websiteUrl,
}: {
  canUseProduct: boolean;
  onLogoChange: (logo: string | null) => void;
  onUseBatch: (products: StudioBatchProduct[]) => void;
  onUseProduct: (
    product: StudioProduct,
    photo: StudioProductPhoto | null,
  ) => void;
  projectId: string;
  websiteUrl?: string | null;
}) {
  const t = useTranslations("App.Studio.WebsiteDraft");
  const [draft, setDraft] = useState<StudioWebsiteDraft | null>(null);
  const [message, setMessage] = useState<"partial" | "empty" | "error" | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const ready = Boolean(draft?.brandCopy || draft?.products);

  function prepare() {
    if (pending) return;
    startTransition(async () => {
      setMessage(null);
      try {
        const result = await prepareStudioWebsiteDraft({ projectId });
        const brandCopy =
          result.brandCopy?.summary ||
          result.brandCopy?.lines.length ||
          result.brandCopy?.tone ||
          result.brandCopy?.audience?.length
            ? result.brandCopy
            : null;
        const products = result.products?.length ? result.products : null;
        const unavailable =
          result.brandCopy === null || result.products === null;
        setDraft({ brandCopy, products });
        if (!brandCopy && !products)
          setMessage(unavailable ? "error" : "empty");
        else if (unavailable) setMessage("partial");
      } catch {
        setMessage("error");
      }
    });
  }

  return (
    <>
      {websiteUrl ? (
        <Button
          loading={pending}
          onClick={prepare}
          size="sm"
          type="button"
          variant="outline"
        >
          <Globe aria-hidden />
          {t("prepare")}
        </Button>
      ) : null}
      <StudioBrandKitDialog
        disabled={pending}
        onLogoChange={onLogoChange}
        onWebsiteCopyReviewed={() =>
          setDraft((current) => current && { ...current, brandCopy: null })
        }
        projectId={projectId}
        websiteCopy={draft?.brandCopy}
        websiteUrl={websiteUrl}
      />
      <StudioProductCatalogDialog
        canUseProduct={canUseProduct}
        disabled={pending}
        onUseBatch={onUseBatch}
        onUseProduct={onUseProduct}
        onWebsiteProductsReviewed={() =>
          setDraft((current) => current && { ...current, products: null })
        }
        projectId={projectId}
        websiteProducts={draft?.products}
        websiteUrl={websiteUrl}
      />
      {message || ready ? (
        <p
          className="text-muted-foreground order-last basis-full text-right text-xs"
          role="status"
        >
          {t(message ?? "ready")}
        </p>
      ) : null}
    </>
  );
}
