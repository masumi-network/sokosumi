import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { listStudioBatchAssets } from "@/lib/actions/image-studio/action";

import { canCompareStudioAsset } from "./studio-batch";
import type { StudioAsset, StudioLabels } from "./types";

export function StudioBatchCompareButton({
  asset,
  labels,
  onCompare,
}: {
  asset: StudioAsset;
  labels: StudioLabels;
  onCompare: (asset: StudioAsset) => void;
}) {
  const t = useTranslations("App.Studio.Pairwise");
  const { projectId, batchId } = asset;
  const query = useQuery({
    queryKey: ["studio-batch-assets", projectId, batchId],
    queryFn: () => listStudioBatchAssets({ projectId, batchId: batchId ?? "" }),
    enabled: Boolean(batchId),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const assets = query.data ?? [];
  if (query.isError) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm" role="status">
          {t("loadFailed")}
        </p>
        <Button
          onClick={() => void query.refetch()}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("retry")}
        </Button>
      </div>
    );
  }
  if (!assets.some((candidate) => canCompareStudioAsset(candidate, assets)))
    return null;
  return (
    <Button
      onClick={() => onCompare(asset)}
      size="sm"
      type="button"
      variant="secondary"
    >
      {labels.compare}
    </Button>
  );
}
