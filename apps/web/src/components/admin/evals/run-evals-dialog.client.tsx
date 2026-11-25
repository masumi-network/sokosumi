"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createAdminEvalRunAction } from "@/lib/actions/admin-evals/action";
import { adminEvalRunHref } from "@/lib/constants/admin-evals";

type Suites = "all" | "soko-bot" | "cmo";

/** Which versions a run can test, and the one it tests when none is picked. */
export interface EvalVersionChoices {
  defaultId: string;
  ids: string[];
}

const DEFAULT_VERSION = "default";

/**
 * Starts a run by hand: after a merge, or on preprod while developing. It
 * queues behind a run already in progress, because the lanes run one run at
 * a time.
 */
export function RunEvalsDialog({
  sokoBotVersions,
  cusoVersions,
}: {
  sokoBotVersions: EvalVersionChoices;
  cusoVersions: EvalVersionChoices;
}) {
  const t = useTranslations("App.Admin.Evals.RunDialog");
  const router = useRouter();
  const casesId = useId();
  const [open, setOpen] = useState(false);
  const [suites, setSuites] = useState<Suites>("all");
  const [repeats, setRepeats] = useState("1");
  const [cases, setCases] = useState("");
  const [sokoBotVersion, setSokoBotVersion] = useState(DEFAULT_VERSION);
  const [cusoVersion, setCusoVersion] = useState(DEFAULT_VERSION);
  const [pending, startTransition] = useTransition();

  const runsSokoBot = suites !== "cmo";
  const runsCmo = suites !== "soko-bot";
  const chosen = (version: string, shown: boolean) =>
    shown && version !== DEFAULT_VERSION ? version : undefined;

  function start() {
    startTransition(async () => {
      const caseIds = cases
        .split(/[\s,]+/)
        .map((id) => id.trim())
        .filter(Boolean);
      const result = await createAdminEvalRunAction({
        suites: suites === "all" ? ["soko-bot", "cmo"] : [suites],
        repeats: Number(repeats),
        caseIds,
        sokoBotVersionId: chosen(sokoBotVersion, runsSokoBot),
        cusoVersionId: chosen(cusoVersion, runsCmo),
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      setOpen(false);
      router.push(adminEvalRunHref(result.value.id));
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Play aria-hidden className="size-4" />
        {t("open")}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("suites")}</Label>
              <ToggleGroup
                type="single"
                aria-label={t("suites")}
                value={suites}
                onValueChange={(value) => value && setSuites(value as Suites)}
                className="w-full"
              >
                <ToggleGroupItem value="all">{t("all")}</ToggleGroupItem>
                <ToggleGroupItem value="soko-bot">
                  {t("sokoBot")}
                </ToggleGroupItem>
                <ToggleGroupItem value="cmo">{t("cmo")}</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="space-y-2">
              <Label>{t("repeats")}</Label>
              <ToggleGroup
                type="single"
                aria-label={t("repeats")}
                value={repeats}
                onValueChange={(value) => value && setRepeats(value)}
              >
                {["1", "2", "3"].map((count) => (
                  <ToggleGroupItem key={count} value={count}>
                    {count}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-muted-foreground text-xs">
                {t("repeatsHint")}
              </p>
            </div>
            {runsSokoBot ? (
              <VersionSelect
                label={t("sokoBotVersion")}
                choices={sokoBotVersions}
                value={sokoBotVersion}
                onChange={setSokoBotVersion}
              />
            ) : null}
            {runsCmo ? (
              <VersionSelect
                label={t("cusoVersion")}
                choices={cusoVersions}
                value={cusoVersion}
                onChange={setCusoVersion}
              />
            ) : null}
            <div className="space-y-2">
              <Label htmlFor={casesId}>{t("cases")}</Label>
              <Textarea
                id={casesId}
                value={cases}
                onChange={(event) => setCases(event.target.value)}
                placeholder={t("casesPlaceholder")}
                className="font-mono text-xs"
                rows={3}
              />
              <p className="text-muted-foreground text-xs">{t("casesHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button loading={pending} onClick={start}>
              <Play aria-hidden className="size-4" />
              {t("start")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function VersionSelect({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: EvalVersionChoices;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("App.Admin.Evals.RunDialog");
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_VERSION} className="font-mono text-xs">
            {t("defaultVersion", { version: choices.defaultId })}
          </SelectItem>
          {choices.ids.map((versionId) => (
            <SelectItem
              key={versionId}
              value={versionId}
              className="font-mono text-xs"
            >
              {versionId}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
