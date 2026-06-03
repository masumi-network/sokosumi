"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { filterCoworkersForComposeKind } from "@/app/chat/utils/coworker-utils";
import type { Coworker } from "@/app/chat/utils/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SelectCoworkerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (coworker: Coworker) => void;
  coworkers?: Coworker[];
}

function getCoworkerAvatarUrl(coworker: Coworker): string | null {
  return coworker.avatar ?? null;
}

export default function SelectCoworkerModal({
  open,
  onOpenChange,
  onSelect,
  coworkers: propCoworkers,
}: SelectCoworkerModalProps) {
  const t = useTranslations("App.Chat.Chat");
  const [selectedCoworkerId, setSelectedCoworkerId] = useState<string>("");

  const coworkers = useMemo(
    () => filterCoworkersForComposeKind(propCoworkers ?? [], "chat"),
    [propCoworkers],
  );

  const selectedCoworker = coworkers.find((c) => c.id === selectedCoworkerId);

  const handleConfirm = () => {
    if (selectedCoworker) {
      onSelect(selectedCoworker);
      setSelectedCoworkerId("");
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    setSelectedCoworkerId("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("selectCoworker.title")}</DialogTitle>
          <DialogDescription>
            {t("selectCoworker.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <Select
            value={selectedCoworkerId}
            onValueChange={setSelectedCoworkerId}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("selectCoworker.placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {coworkers.map((coworker) => (
                <SelectItem key={coworker.id} value={coworker.id}>
                  <div className="flex items-center gap-2">
                    <Avatar className="size-6">
                      <AvatarImage
                        src={getCoworkerAvatarUrl(coworker) ?? undefined}
                        alt={coworker.name}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                        {coworker.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span>{coworker.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedCoworker && (
            <div className="bg-muted/50 space-y-2 rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-10">
                  {getCoworkerAvatarUrl(selectedCoworker) && (
                    <AvatarImage
                      src={getCoworkerAvatarUrl(selectedCoworker)!}
                      alt={selectedCoworker.name}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {selectedCoworker.name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-semibold">{selectedCoworker.name}</h3>
                  <p className="text-muted-foreground text-sm">
                    {selectedCoworker.description}
                  </p>
                </div>
              </div>
              {selectedCoworker.useCase ? (
                <div className="text-sm">
                  <span className="font-medium">
                    {t("selectCoworker.useCase")}:{" "}
                  </span>
                  <span className="text-muted-foreground">
                    {selectedCoworker.useCase}
                  </span>
                </div>
              ) : null}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t("selectCoworker.cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedCoworker}>
            {t("selectCoworker.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
