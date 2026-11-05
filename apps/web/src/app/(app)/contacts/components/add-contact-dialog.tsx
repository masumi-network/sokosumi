"use client";
import { ContactChannelType } from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { coreErrorOf } from "@/app/contacts/contacts-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { contactsService } from "@/lib/services/contacts.client";
import { ChannelTypeSelect } from "./channel-type-select";
import { refreshContacts } from "./use-contacts-data";

interface ChannelDraft {
  key: string;
  type: ContactChannelType;
  value: string;
}

function newChannel(type: ContactChannelType = "EMAIL"): ChannelDraft {
  return { key: crypto.randomUUID(), type, value: "" };
}

/**
 * A name and/or any ways to reach someone. A channel the team already has
 * is never duplicated: Core answers 409 with that contact, offered here.
 */
export function AddContactDialog({
  onClose,
  onCreated,
  onOpenExisting,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  onOpenExisting: (id: string) => void;
}) {
  const t = useTranslations("App.Contacts.addDialog");
  const cache = useQueryClient();
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [role, setRole] = useState("");
  const [channels, setChannels] = useState<ChannelDraft[]>([newChannel()]);
  const [prospect, setProspect] = useState(false);
  const [whyInteresting, setWhyInteresting] = useState("");
  const [error, setError] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function updateChannel(key: string, change: Partial<ChannelDraft>) {
    setChannels((previous) =>
      previous.map((item) =>
        item.key === key ? { ...item, ...change } : item,
      ),
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const filled = channels.filter((channel) => channel.value.trim());
    if (!name.trim() && !filled.length) {
      setError(t("nameOrChannel"));
      return;
    }
    setPending(true);
    setError("");
    setExistingId(null);
    try {
      const result = await contactsService.create({
        name: name.trim() || undefined,
        organization: organization.trim() || null,
        role: role.trim() || null,
        stage: prospect ? "PROSPECT" : undefined,
        whyInteresting: prospect ? whyInteresting.trim() || null : undefined,
        channels: filled.map((channel, index) => ({
          type: channel.type,
          value: channel.value.trim(),
          isPrimary: index === 0,
          source: "MANUAL",
        })),
        upsert: false,
      });
      await refreshContacts(cache);
      onCreated(result.contact.id);
    } catch (caught) {
      const failure = coreErrorOf(caught);
      if (
        failure.kind === "contact_channel_taken" &&
        failure.existingContactId
      ) {
        setExistingId(failure.existingContactId);
        setError(t("channelTaken"));
      } else setError(failure.message ?? t("failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="app-scrollbar max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="add-contact-name">{t("name")}</Label>
            <Input
              id="add-contact-name"
              value={name}
              maxLength={200}
              autoComplete="off"
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="add-contact-organization">
                {t("organization")}
              </Label>
              <Input
                id="add-contact-organization"
                value={organization}
                maxLength={200}
                autoComplete="off"
                onChange={(event) => setOrganization(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-contact-role">{t("role")}</Label>
              <Input
                id="add-contact-role"
                value={role}
                maxLength={200}
                autoComplete="off"
                onChange={(event) => setRole(event.target.value)}
              />
            </div>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">
              {t("channels")}
            </legend>
            {channels.map((channel, index) => (
              <div key={channel.key} className="flex items-center gap-2">
                <ChannelTypeSelect
                  value={channel.type}
                  label={t("channelType", { index: index + 1 })}
                  onChange={(type) => updateChannel(channel.key, { type })}
                />
                <Input
                  aria-label={t("channelValue", { index: index + 1 })}
                  value={channel.value}
                  autoComplete="off"
                  type={channel.type === "EMAIL" ? "email" : "text"}
                  placeholder={t(`placeholders.${channel.type}`)}
                  onChange={(event) =>
                    updateChannel(channel.key, { value: event.target.value })
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground size-10 shrink-0"
                  aria-label={t("removeChannel", { index: index + 1 })}
                  disabled={channels.length === 1}
                  onClick={() =>
                    setChannels((previous) =>
                      previous.filter((item) => item.key !== channel.key),
                    )
                  }
                >
                  <X aria-hidden className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground w-fit"
              onClick={() =>
                setChannels((previous) => [
                  ...previous,
                  newChannel(previous.length ? "LINKEDIN" : "EMAIL"),
                ])
              }
            >
              <Plus aria-hidden className="size-4" />
              {t("addChannel")}
            </Button>
          </fieldset>
          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="add-contact-prospect"
                checked={prospect}
                onCheckedChange={(checked) => setProspect(checked === true)}
                className="mt-0.5"
              />
              <div className="grid gap-0.5">
                <Label htmlFor="add-contact-prospect">{t("prospect")}</Label>
                <p className="text-muted-foreground text-xs">
                  {t("prospectHint")}
                </p>
              </div>
            </div>
            {prospect ? (
              <div className="grid gap-2">
                <Label htmlFor="add-contact-why">{t("whyInteresting")}</Label>
                <Textarea
                  id="add-contact-why"
                  value={whyInteresting}
                  rows={3}
                  maxLength={2000}
                  placeholder={t("whyPlaceholder")}
                  onChange={(event) => setWhyInteresting(event.target.value)}
                />
              </div>
            ) : null}
          </div>
          {error ? (
            <Alert variant={existingId ? "default" : "destructive"}>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-foreground">{error}</span>
                {existingId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenExisting(existingId)}
                  >
                    {t("openExisting")}
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
