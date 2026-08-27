"use client";

import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface QualityVersionOption {
  versionId: string;
  name: string | null;
}

interface QualityVersionFilterProps {
  selectedVersionId?: string | null;
  versions: QualityVersionOption[];
}

export function QualityVersionFilter({
  selectedVersionId = null,
  versions,
}: QualityVersionFilterProps) {
  const t = useTranslations("App.Admin.SokoBots.Quality");
  const [, setVersionId] = useQueryState("qualityVersion", {
    history: "replace",
    shallow: false,
  });

  function handleVersionChange(value: string) {
    void setVersionId(value === "all" ? null : value);
  }

  return (
    <div className="flex w-full flex-col items-stretch gap-1 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
      <Label
        htmlFor="quality-version"
        className="text-muted-foreground text-xs"
      >
        {t("versionFilter")}
      </Label>
      <Select
        value={selectedVersionId ?? "all"}
        onValueChange={handleVersionChange}
      >
        <SelectTrigger
          id="quality-version"
          size="sm"
          className="w-full sm:min-w-48"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("allVersions")}</SelectItem>
          {versions.map((version) => (
            <SelectItem key={version.versionId} value={version.versionId}>
              {version.name ?? version.versionId}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
