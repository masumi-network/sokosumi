/** Playwright capture page for Social preview footer vs menu actions. */
import { MoreHorizontal } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { createRoot } from "react-dom/client";
import { SocialPostPreview } from "@/app/projects/components/social-posts/social-post-preview";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { createFormats } from "@/i18n/time-format";
import messages from "@/messages/en.json";

function duplicateMenu(): boolean {
  return new URLSearchParams(window.location.search).get("variant") !== "after";
}

export function SocialPreviewActionsPage() {
  useMountEffect(() => {
    document.body.dataset.hydrated = "true";
  });

  const showComposeInMenu = duplicateMenu();

  return (
    <NextIntlClientProvider
      formats={createFormats("h12")}
      locale="en"
      messages={messages}
      timeZone="UTC"
    >
      <div className="bg-muted min-h-screen p-6">
        <div
          className="bg-background w-full max-w-md rounded-lg border p-6 shadow-lg"
          data-testid="social-preview-actions-dialog"
        >
          <div className="flex flex-col gap-2 text-left">
            <h2 className="text-lg leading-none font-semibold">Post preview</h2>
            <p className="text-muted-foreground text-sm">Oct 1, 10:00 AM</p>
          </div>
          <div className="mt-4">
            <SocialPostPreview
              account={{
                handle: "sokosumi",
                displayName: "Sokosumi HQ",
                avatarUrl: null,
              }}
              media={[]}
              provider="x"
              text="Launch day is here."
              timestamp={new Date("2026-10-01T10:00:00.000Z")}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <DropdownMenu modal={false} open>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Post actions"
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="min-h-11">
                  Publish now
                </DropdownMenuItem>
                {showComposeInMenu ? (
                  <DropdownMenuItem className="min-h-11">Edit</DropdownMenuItem>
                ) : null}
                {showComposeInMenu ? (
                  <DropdownMenuItem className="min-h-11">
                    Reschedule
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem className="min-h-11" variant="destructive">
                  Cancel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 md:min-h-10"
            >
              Edit
            </Button>
            <Button type="button" className="min-h-11 md:min-h-10">
              Reschedule
            </Button>
          </div>
        </div>
      </div>
    </NextIntlClientProvider>
  );
}

export function mountSocialPreviewActionsPage() {
  const root = document.getElementById("fixture");
  if (!root) throw new Error("Missing #fixture");
  createRoot(root).render(<SocialPreviewActionsPage />);
}

if (typeof document !== "undefined" && document.getElementById("fixture")) {
  try {
    mountSocialPreviewActionsPage();
  } catch (error) {
    document.body.dataset.moduleError = String(error);
  }
}
