import type {
  SocialPostCalendarItem,
  WorkspaceCalendarEntry,
} from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { rescheduleProjectSocialPost } from "@/lib/actions/project/action";

const CHANGEABLE_SOCIAL_STATUSES: ReadonlySet<
  SocialPostCalendarItem["status"]
> = new Set(["SCHEDULED", "FAILED", "MISSED"]);

export function isChangeableSocialPost(
  item: WorkspaceCalendarEntry,
): item is SocialPostCalendarItem {
  return (
    item.kind === "socialPost" && CHANGEABLE_SOCIAL_STATUSES.has(item.status)
  );
}

/** Reads the current revision on the server, then schedules the dropped instant. */
export function rescheduleSocialPost(
  item: SocialPostCalendarItem,
  scheduledAt: Date,
) {
  return rescheduleProjectSocialPost({
    projectId: item.sourceProjectId,
    postId: item.postId,
    scheduledAt: scheduledAt.toISOString(),
  });
}

/** Conflict reloads the calendar; every failure also needs a toast. */
export function useReportSocialRescheduleFailure() {
  const t = useTranslations("App.Projects.SocialPosts.toasts");
  const router = useRouter();
  return (error?: ActionError) => {
    if (error?.kind === CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT) {
      router.refresh();
      toast.error(t("conflict"));
      return;
    }
    toast.error(error?.message || t("failed"));
  };
}
