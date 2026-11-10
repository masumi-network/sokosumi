import type {
  StudioLogoPosition,
  StudioProduct,
  StudioProductPhoto,
  StudioWebsiteDraft,
} from "@sokosumi/core-client";
import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { prepareStudioWebsiteDraft } from "@/lib/actions/image-studio/brand-kit";

import type { StudioBatchProduct } from "./studio-batch";
import { StudioBrandKitDialog } from "./studio-brand-kit";
import { StudioProductCatalogDialog } from "./studio-product-catalog";
import { consumeStudioWebsiteDraftRequest } from "./studio-website-intent";

export function StudioWebsiteTools({
  canUseProduct,
  onLogoChange,
  onUseBatch,
  onUseProduct,
  projectId,
  websiteUrl,
}: {
  canUseProduct: boolean;
  onLogoChange: (
    logo: string | null,
    position: StudioLogoPosition | null,
  ) => void;
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
  const ready = Boolean(draft?.brandCopy || draft?.products || draft?.visual);

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
        const visual = result.visual ?? null;
        const unavailable =
          result.brandCopy === null || result.products === null;
        setDraft({ brandCopy, products, visual });
        if (!brandCopy && !products && !visual)
          setMessage(unavailable ? "error" : "empty");
        else if (unavailable) setMessage("partial");
      } catch {
        setMessage("error");
      }
    });
  }

  function reviewVisual(part: "logo" | "look") {
    setDraft((current) => {
      if (!current?.visual) return current;
      const visual =
        part === "logo"
          ? { ...current.visual, logo: null }
          : { ...current.visual, colors: [], fonts: [] };
      return {
        ...current,
        visual:
          visual.logo || visual.colors.length || visual.fonts.length
            ? visual
            : null,
      };
    });
  }

  useMountEffect(() => {
    if (websiteUrl && consumeStudioWebsiteDraftRequest(projectId)) prepare();
  });

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
        websiteVisual={draft?.visual}
        onWebsiteVisualReviewed={reviewVisual}
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
      {pending || message || ready ? (
        <p
          className="text-muted-foreground order-last basis-full text-right text-xs"
          role="status"
        >
          {t(pending ? "preparing" : (message ?? "ready"))}
        </p>
      ) : null}
    </>
  );
}
