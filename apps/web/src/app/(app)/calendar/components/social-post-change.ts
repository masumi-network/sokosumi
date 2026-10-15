import type {
  SocialPostCalendarItem,
  WorkspaceCalendarEntry,
} from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { scheduleProjectSocialPost } from "@/lib/actions/project/action";

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

/** Schedule the dropped instant with the revision the calendar originally read. */
export function rescheduleSocialPost(
  item: SocialPostCalendarItem,
  scheduledAt: Date,
) {
  return scheduleProjectSocialPost({
    projectId: item.sourceProjectId,
    postId: item.postId,
    scheduledAt: scheduledAt.toISOString(),
    revision: item.revision,
  });
}

/** Conflict reloads the calendar; every failure also needs a toast. */
export function useReportSocialRescheduleFailure() {
  const t = useTranslations("App.Projects.SocialPosts.toasts");
  const router = useRouter();
  return (error?: ActionError) => {
    if (error?.kind === CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT) {
      router.refresh();
      toast.error(t("conflict"), { duration: Infinity, closeButton: true });
      return;
    }
    toast.error(error?.message || t("failed"), {
      duration: Infinity,
      closeButton: true,
    });
  };
}
