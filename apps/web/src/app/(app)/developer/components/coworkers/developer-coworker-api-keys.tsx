"use client";

import { Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { CreateApiKeyDialog } from "@/app/developer/components/api-keys/create-api-key-dialog";
import type {
  CreateApiKeyRequest,
  CreateApiKeyResult,
} from "@/app/developer/components/api-keys/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createDeveloperCoworkerApiKeyAction,
  revokeDeveloperCoworkerApiKeyAction,
} from "@/lib/actions/coworkers/api-keys.action";

export interface CoworkerApiKeyRow {
  id: string;
  name: string | null;
  keyStart: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  status: "active" | "revoked" | "expired";
}

interface DeveloperCoworkerApiKeysProps {
  coworkerId: string;
  rows: CoworkerApiKeyRow[];
  loadFailed: boolean;
}

export function DeveloperCoworkerApiKeys({
  coworkerId,
  rows,
  loadFailed,
}: DeveloperCoworkerApiKeysProps) {
  const t = useTranslations("App.Developer.Coworkers.ApiKeys");
  const format = useFormatter();
  const [createOpen, setCreateOpen] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<CoworkerApiKeyRow | null>(
    null,
  );
  const [revoking, setRevoking] = useState(false);

  async function createApiKey(
    data: CreateApiKeyRequest,
  ): Promise<CreateApiKeyResult> {
    const result = await createDeveloperCoworkerApiKeyAction({
      coworkerId,
      name: data.name,
    });
    if (!result.ok) {
      // Core's message is English; the toast stays in the page's language.
      const message = t("createError");
      toast.error(message);
      return { ok: false, error: { message } };
    }
    toast.success(t("createSuccess"));
    return result;
  }

  async function handleConfirmRevoke() {
    if (!keyToRevoke || revoking) {
      return;
    }
    setRevoking(true);
    try {
      const result = await revokeDeveloperCoworkerApiKeyAction({
        coworkerId,
        keyId: keyToRevoke.id,
      });
      if (!result.ok) {
        toast.error(t("revokeError"));
        return;
      }
      toast.success(t("revokeSuccess"));
      setKeyToRevoke(null);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          {t("createButton")}
        </Button>
      </CardHeader>
      <CardContent>
        {loadFailed ? (
          <p className="text-destructive text-sm">{t("loadError")}</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Table.name")}</TableHead>
                <TableHead className="hidden sm:table-cell">
                  {t("Table.key")}
                </TableHead>
                <TableHead className="hidden sm:table-cell">
                  {t("Table.created")}
                </TableHead>
                <TableHead className="hidden sm:table-cell">
                  {t("Table.lastUsed")}
                </TableHead>
                <TableHead>{t("Table.status")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("Table.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {row.name ?? t("unnamed")}
                    {/* Below sm the Key column is hidden; keep the prefix so two keys with one name stay apart. */}
                    <span className="text-muted-foreground block font-mono text-xs sm:hidden">
                      {row.keyStart}…
                    </span>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs sm:table-cell">
                    {row.keyStart}…
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {format.dateTime(row.createdAt, { dateStyle: "medium" })}
                  </TableCell>
                  <TableCell className="hidden whitespace-normal sm:table-cell">
                    {row.lastUsedAt
                      ? format.dateTime(row.lastUsedAt, "dateTimeMedium")
                      : t("noRecordedUse")}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={row.status === "active" ? "secondary" : "muted"}
                    >
                      {t(`Status.${row.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {row.status === "active" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive h-10 md:h-8"
                        onClick={() => setKeyToRevoke(row)}
                      >
                        {t("revokeButton")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <CreateApiKeyDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSuccess={() => {}}
          createApiKey={createApiKey}
        />

        <AlertDialog
          open={keyToRevoke !== null}
          onOpenChange={(open) => {
            if (!open && !revoking) {
              setKeyToRevoke(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("RevokeDialog.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("RevokeDialog.description", {
                  name: keyToRevoke?.name ?? t("unnamed"),
                  keyStart: keyToRevoke?.keyStart ?? "",
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={revoking}>
                {t("RevokeDialog.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                loading={revoking}
                className={buttonVariants({ variant: "destructive" })}
                onClick={(event) => {
                  event.preventDefault();
                  void handleConfirmRevoke();
                }}
              >
                {t("RevokeDialog.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
