"use client";

import type { SocialPost } from "@sokosumi/core-client";
import { AlertTriangle, BarChart3, Calendar, PenSquare } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SocialTaskHubProps {
  /** Posts from all sections for activity feed */
  recentPosts?: SocialPost[];
  /** Count of failed posts */
  failedCount: number;
  /** Callback to create new post */
  onCreatePost: () => void;
  /** Callback to view schedule */
  onViewSchedule: () => void;
  /** Callback to fix failed posts */
  onFixFailedPosts: () => void;
  /** Callback to review performance */
  onReviewPerformance: () => void;
  /** Project name for context */
  projectName?: string | null;
}

/**
 * Task-centric hub for Social Scheduling.
 * Presents clear action cards and recent activity.
 */
export function SocialTaskHub({
  recentPosts = [],
  failedCount,
  onCreatePost,
  onViewSchedule,
  onFixFailedPosts,
  onReviewPerformance,
  projectName,
}: SocialTaskHubProps) {
  const t = useTranslations("App.Social.taskHub");
  const format = useFormatter();

  const recentActivity = recentPosts.slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{t("title")}</h2>
        {projectName && (
          <p className="text-sm text-muted-foreground mt-1">
            {t("projectContext", { project: projectName })}
          </p>
        )}
      </div>

      {/* Task Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TaskCard
          icon={PenSquare}
          title={t("createPost.title")}
          description={t("createPost.description")}
          action={
            <Button onClick={onCreatePost} className="w-full sm:w-auto">
              {t("createPost.action")}
            </Button>
          }
          variant="primary"
        />

        <TaskCard
          icon={Calendar}
          title={t("viewSchedule.title")}
          description={t("viewSchedule.description")}
          action={
            <Button
              onClick={onViewSchedule}
              variant="outline"
              className="w-full sm:w-auto"
            >
              {t("viewSchedule.action")}
            </Button>
          }
        />

        {failedCount > 0 && (
          <TaskCard
            icon={AlertTriangle}
            title={t("fixFailed.title", { count: failedCount })}
            description={t("fixFailed.description")}
            action={
              <Button
                onClick={onFixFailedPosts}
                variant="destructive"
                className="w-full sm:w-auto"
              >
                {t("fixFailed.action")}
              </Button>
            }
            variant="error"
          />
        )}

        <TaskCard
          icon={BarChart3}
          title={t("reviewPerformance.title")}
          description={t("reviewPerformance.description")}
          action={
            <Button
              onClick={onReviewPerformance}
              variant="outline"
              className="w-full sm:w-auto"
            >
              {t("reviewPerformance.action")}
            </Button>
          }
        />
      </div>

      {/* Recent Activity */}
      {recentActivity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("recentActivity.title")}
            </CardTitle>
            <CardDescription>{t("recentActivity.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentActivity.map((post) => (
                <ActivityItem key={post.id} post={post} format={format} t={t} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface TaskCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action: React.ReactNode;
  variant?: "primary" | "error";
}

function TaskCard({
  icon: Icon,
  title,
  description,
  action,
  variant,
}: TaskCardProps) {
  return (
    <Card
      className={cn(
        "hover:shadow-md transition-shadow",
        variant === "error" && "border-destructive/50",
      )}
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "rounded-lg p-2",
              variant === "primary" && "bg-primary/10 text-primary",
              variant === "error" && "bg-destructive/10 text-destructive",
              !variant && "bg-muted",
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="text-sm">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>{action}</CardContent>
    </Card>
  );
}

interface ActivityItemProps {
  post: SocialPost;
  format: ReturnType<typeof useFormatter>;
  t: ReturnType<typeof useTranslations<"App.Social.taskHub">>;
}

function ActivityItem({ post, format, t }: ActivityItemProps) {
  const statusText = getActivityStatusText(post.status, t);
  const timeAgo = format.relativeTime(new Date(post.updatedAt));

  return (
    <div className="flex items-start gap-3 text-sm">
      <div
        className={cn(
          "h-2 w-2 rounded-full mt-1.5 flex-shrink-0",
          post.status === "PUBLISHED" && "bg-success",
          post.status === "SCHEDULED" && "bg-primary",
          post.status === "DRAFT" && "bg-muted-foreground",
          post.status === "FAILED" && "bg-destructive",
        )}
      />
      <div className="flex-1 min-w-0">
        <p className="text-foreground truncate">
          {post.text.length > 60
            ? `${post.text.slice(0, 60)}...`
            : post.text || t("recentActivity.untitled")}
        </p>
        <p className="text-muted-foreground text-xs mt-0.5">
          {statusText} • {timeAgo}
        </p>
      </div>
    </div>
  );
}

function getActivityStatusText(
  status: SocialPost["status"],
  t: ReturnType<typeof useTranslations<"App.Social.taskHub">>,
): string {
  switch (status) {
    case "PUBLISHED":
      return t("recentActivity.status.published");
    case "SCHEDULED":
      return t("recentActivity.status.scheduled");
    case "DRAFT":
      return t("recentActivity.status.draft");
    case "FAILED":
      return t("recentActivity.status.failed");
    case "MISSED":
      return t("recentActivity.status.missed");
    case "CANCELED":
      return t("recentActivity.status.cancelled");
    case "PUBLISHING":
      return t("recentActivity.status.publishing");
    default:
      return t("recentActivity.status.unknown");
  }
}
