"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveAdDataConsent } from "@/lib/actions/ad-data-consent/action";

interface AdDataConsentFormProps {
  workspaceId: string;
  shareForImprovement: boolean;
  allowTraining: boolean;
  canEdit: boolean;
}

export function AdDataConsentForm({
  workspaceId,
  shareForImprovement,
  allowTraining,
  canEdit,
}: AdDataConsentFormProps) {
  const t = useTranslations("App.AdDataConsent");
  const [share, setShare] = useState(shareForImprovement);
  const [training, setTraining] = useState(allowTraining);
  const [saved, setSaved] = useState({
    share: shareForImprovement,
    training: allowTraining,
  });
  const [pending, startTransition] = useTransition();
  const changed = share !== saved.share || training !== saved.training;

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      try {
        const result = await saveAdDataConsent({
          workspaceId,
          shareForImprovement: share,
          allowTraining: training,
        });
        if (!result.ok) {
          toast.error(t("saveError"));
          return;
        }
        setSaved({ share, training });
        toast.success(t("saved"));
      } catch {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor={`ad-share-${workspaceId}`}>
                {t("shareLabel")}
              </Label>
              <p
                id={`ad-share-help-${workspaceId}`}
                className="text-muted-foreground text-sm"
              >
                {t("shareHelp")}
              </p>
            </div>
            <Switch
              id={`ad-share-${workspaceId}`}
              aria-describedby={`ad-share-help-${workspaceId}`}
              checked={share}
              disabled={!canEdit || pending}
              onCheckedChange={(checked) => {
                setShare(checked);
                if (!checked) setTraining(false);
              }}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor={`ad-training-${workspaceId}`}>
                {t("trainingLabel")}
              </Label>
              <p
                id={`ad-training-help-${workspaceId}`}
                className="text-muted-foreground text-sm"
              >
                {t("trainingHelp")}
              </p>
            </div>
            <Switch
              id={`ad-training-${workspaceId}`}
              aria-describedby={`ad-training-help-${workspaceId}`}
              checked={training}
              disabled={!canEdit || !share || pending}
              onCheckedChange={setTraining}
            />
          </div>
          {canEdit ? (
            <Button
              type="submit"
              loading={pending}
              disabled={!changed || pending}
              size="sm"
            >
              {t("save")}
            </Button>
          ) : (
            <p className="text-muted-foreground text-sm">{t("adminOnly")}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
