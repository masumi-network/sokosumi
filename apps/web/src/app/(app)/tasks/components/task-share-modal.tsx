"use client";

import { Check, Copy, Globe, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CoreApiRequestError,
  coreClient,
} from "@/lib/clients/core.browser.client";
import type { TaskShare } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

interface TaskShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  share: TaskShare | null;
}

export function TaskShareModal({
  open,
  onOpenChange,
  taskId,
  share,
}: TaskShareModalProps) {
  const t = useTranslations("App.Tasks.Detail.ShareModal");
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const [taskShare, setTaskShare] = useState<TaskShare | null>(share);

  const ignoreStaleShareAfterDeleteRef = useRef(false);

  useEffect(() => {
    setTaskShare((prev) => {
      if (prev?.token && !share?.token) {
        return prev;
      }
      if (ignoreStaleShareAfterDeleteRef.current && share?.token) {
        return prev;
      }
      if (share === null) {
        ignoreStaleShareAfterDeleteRef.current = false;
      }
      return share;
    });
  }, [share]);

  const link =
    isClient && taskShare?.token
      ? new URL(`/share/${taskShare.token}`, window.location.origin)
      : null;

  function syncTaskShare(nextTaskShare: TaskShare | null) {
    setTaskShare(nextTaskShare);
    router.refresh();
  }

  const handleOnOpenChange = (nextOpen: boolean) => {
    if (isLoading) {
      return;
    }

    if (nextOpen) {
      setTaskShare(share);
    }

    onOpenChange(nextOpen);
  };

  function handleShareError(error: unknown) {
    const status =
      error instanceof CoreApiRequestError ? error.status : undefined;

    switch (status) {
      case 401:
        toast.error(t("Errors.unauthenticated"), {
          action: {
            label: t("Errors.unauthenticatedAction"),
            onClick: () => {
              router.push("/login");
            },
          },
        });
        break;
      case 403:
        toast.error(t("Errors.unauthorized"));
        break;
      case 404:
        toast.error(t("Errors.taskNotFound"));
        break;
      default:
        toast.error(t("Error.share"));
        break;
    }
  }

  const handleTogglePublicShare = async () => {
    if (taskShare?.token) {
      return;
    }

    setIsLoading(true);
    try {
      const nextTaskShare = await coreClient.putTaskShare(taskId, {
        allowSearchIndexing: true,
      });
      syncTaskShare(nextTaskShare);
      toast.success(t("Success.share"));
    } catch (error) {
      handleShareError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAllowSearchIndexingChange = async (
    value: boolean | "indeterminate",
  ) => {
    if (!taskShare) {
      return;
    }

    setIsLoading(true);
    try {
      const nextTaskShare = await coreClient.putTaskShare(taskId, {
        allowSearchIndexing: value === true,
      });
      syncTaskShare(nextTaskShare);
      toast.success(t("Success.share"));
    } catch (error) {
      handleShareError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveTaskShare = async () => {
    if (!taskShare?.token) {
      return;
    }

    setIsLoading(true);
    try {
      await coreClient.deleteTaskShare(taskId);
      ignoreStaleShareAfterDeleteRef.current = true;
      syncTaskShare(null);
      toast.success(t("Success.share"));
    } catch (error) {
      handleShareError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!link) {
      return;
    }

    try {
      await navigator.clipboard.writeText(link.toString());
      toast.success(t("Success.copyLink"));
    } catch {
      toast.error(t("Error.copyLink"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOnOpenChange}>
      <DialogContent className="w-svw max-w-lg! border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[80vw] [&>button]:hidden">
        <DialogTitle className="hidden" />
        <DialogDescription className="hidden" />
        <ScrollArea className="max-h-svh md:max-h-[90svh]">
          <div className="bg-background min-h-svh w-svw space-y-4 rounded-none p-4 md:min-h-auto md:w-lg md:rounded-xl md:p-8">
            <h1 className="text-xl font-light">{t("title")}</h1>
            <div className="divide-y rounded-md border">
              <div
                className={cn(
                  "hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-t-md p-4 transition-all",
                  {
                    "pointer-events-none animate-pulse opacity-60": isLoading,
                  },
                )}
                onClick={handleTogglePublicShare}
              >
                <Globe />
                <div className="flex-1">
                  <p className="text-sm">{t("publicAccessTitle")}</p>
                  <p className="text-muted-foreground text-xs">
                    {t("publicAccessDescription")}
                  </p>
                </div>
                {taskShare?.token ? (
                  <Check className="text-semantic-success size-4" />
                ) : null}
              </div>
              <div
                className={cn(
                  "hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-b-md p-4 transition-all",
                  {
                    "pointer-events-none animate-pulse opacity-60": isLoading,
                  },
                )}
                onClick={handleRemoveTaskShare}
              >
                <Lock />
                <div className="flex-1">
                  <p className="text-sm">{t("privateAccessTitle")}</p>
                  <p className="text-muted-foreground text-xs">
                    {t("privateAccessDescription")}
                  </p>
                </div>
                {!taskShare?.token ? (
                  <Check className="text-semantic-success size-4" />
                ) : null}
              </div>
            </div>
            {link && taskShare?.token ? (
              <div className="flex w-full items-center gap-2 rounded-md border p-2">
                <a
                  href={link.toString()}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-muted-foreground truncate text-sm hover:underline"
                >
                  {link.toString()}
                </a>
                <Button variant="ghost" size="icon" onClick={handleCopyLink}>
                  <Copy className="size-4" />
                </Button>
              </div>
            ) : null}
            {taskShare?.token ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="allow-task-search-indexing"
                  disabled={isLoading}
                  className={cn({
                    "pointer-events-none animate-pulse opacity-60": isLoading,
                  })}
                  checked={taskShare.allowSearchIndexing}
                  onCheckedChange={(value) =>
                    handleAllowSearchIndexingChange(value)
                  }
                />
                <Label
                  htmlFor="allow-task-search-indexing"
                  className={cn("cursor-pointer", {
                    "pointer-events-none animate-pulse opacity-60": isLoading,
                  })}
                >
                  {t("allowSearchIndexing")}
                </Label>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
