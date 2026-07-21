"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateAdminCoworkerAction } from "@/lib/actions/admin-coworkers/action";
import type { Coworker } from "@/lib/clients/generated/core/types.gen";

const MIN_NAME_LENGTH = 3;

interface CoworkerFormProps {
  coworker: Coworker;
}

function toFieldValue(value: string | null | undefined): string {
  return value ?? "";
}

export function CoworkerForm({ coworker }: CoworkerFormProps) {
  const t = useTranslations("App.Admin.Coworkers.Form");
  const tContext = useTranslations("App.Admin.Coworkers.Context");
  const router = useRouter();

  const [name, setName] = useState(coworker.name);
  const [caption, setCaption] = useState(toFieldValue(coworker.caption));
  const [description, setDescription] = useState(
    toFieldValue(coworker.description),
  );
  const [image, setImage] = useState(toFieldValue(coworker.image));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length >= MIN_NAME_LENGTH && !isSubmitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await updateAdminCoworkerAction({
        id: coworker.id,
        input: {
          name,
          caption,
          description,
          image,
        },
      });

      if (!result.ok) {
        toast.error(result.error.message ?? t("updateError"));
        return;
      }

      toast.success(t("updateSuccess"));
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-8" onSubmit={handleSubmit}>
      <dl className="grid gap-4 rounded-md border p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{tContext("id")}</dt>
          <dd className="mt-1 font-mono text-xs">{coworker.id}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{tContext("slug")}</dt>
          <dd className="mt-1">{coworker.slug}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{tContext("vendor")}</dt>
          <dd className="mt-1">{coworker.vendor.name}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{tContext("priority")}</dt>
          <dd className="mt-1 tabular-nums">{coworker.priority}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">{tContext("whitelist")}</dt>
          <dd className="mt-2">
            <Badge variant={coworker.isWhitelisted ? "default" : "secondary"}>
              {coworker.isWhitelisted
                ? tContext("whitelisted")
                : tContext("notWhitelisted")}
            </Badge>
          </dd>
        </div>
      </dl>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="coworker-name">{t("Fields.name.label")}</Label>
          <Input
            id="coworker-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={MIN_NAME_LENGTH}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="coworker-caption">{t("Fields.caption.label")}</Label>
          <Input
            id="coworker-caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="coworker-description">
            {t("Fields.description.label")}
          </Label>
          <Textarea
            id="coworker-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="coworker-image">{t("Fields.image.label")}</Label>
          <Input
            id="coworker-image"
            type="text"
            value={image}
            onChange={(event) => setImage(event.target.value)}
            placeholder={t("Fields.image.placeholder")}
          />
          <p className="text-muted-foreground text-xs">
            {t("Fields.image.helper")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={!canSubmit}>
          {isSubmitting ? t("saving") : t("saveChanges")}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/admin/coworkers">{t("cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}
