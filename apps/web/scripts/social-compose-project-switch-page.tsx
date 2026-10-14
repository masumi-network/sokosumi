/** Playwright capture page for Social composer close on project switch. */
import { Check } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { NuqsAdapter } from "nuqs/adapters/react";
import { createRoot } from "react-dom/client";
import {
  SocialComposeProvider,
  useSocialCompose,
} from "@/app/social/components/social-compose-context";
import { TaskFormModal } from "@/app/tasks/components/task-form-modal";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";

const PROJECTS = [
  { id: "brand-launch", name: "Brand launch" },
  { id: "launch-campaign", name: "Launch campaign" },
] as const;

export function SocialComposeProjectSwitchPage() {
  useMountEffect(() => {
    document.body.dataset.hydrated = "true";
  });

  return (
    <NuqsAdapter>
      <SocialComposeProvider>
        <SocialComposeProjectSwitchFixture />
      </SocialComposeProvider>
    </NuqsAdapter>
  );
}

function SocialComposeProjectSwitchFixture() {
  const compose = useSocialCompose();
  const [projectId, setProjectId] = useQueryState("projectId", parseAsString);
  const current =
    PROJECTS.find((project) => project.id === projectId) ?? PROJECTS[0];

  useMountEffect(() => {
    function onSwitch(event: Event) {
      const id = (event as CustomEvent<string>).detail;
      void setProjectId(id);
    }
    window.addEventListener("social-fixture-switch-project", onSwitch);
    return () =>
      window.removeEventListener("social-fixture-switch-project", onSwitch);
  });

  return (
    <div
      className="bg-muted text-foreground flex min-h-screen"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      <aside className="bg-background border-border relative z-[100] flex w-56 shrink-0 flex-col gap-1 border-e p-3">
        <p className="text-muted-foreground px-2 py-1 text-xs font-medium">
          Projects
        </p>
        {PROJECTS.map((project) => {
          const selected = project.id === current.id;
          return (
            <button
              className={
                selected
                  ? "bg-accent text-accent-foreground rounded-md px-2 py-2 text-left text-sm font-medium"
                  : "text-foreground hover:bg-accent rounded-md px-2 py-2 text-left text-sm"
              }
              data-testid={`switch-project-${project.id}`}
              key={project.id}
              onClick={() => void setProjectId(project.id)}
              type="button"
            >
              {project.name}
            </button>
          );
        })}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 px-6 py-4">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">Social</p>
            <h1 className="truncate text-lg font-semibold">{current.name}</h1>
          </div>
          <Button
            onClick={() => compose?.setOpen(true)}
            size="sm"
            type="button"
          >
            New post
          </Button>
        </header>
        <div className="px-6 pb-6">
          <p className="text-muted-foreground text-sm">
            Drafts stay with this project.
          </p>
        </div>
      </main>
      <TaskFormModal
        cancelLabel="Close"
        onOpenChange={(open) => compose?.setOpen(open)}
        open={compose?.open ?? false}
        title="New post"
      >
        <div
          className="flex min-h-0 flex-1 flex-col"
          data-testid="social-post-composer-surface"
        >
          <div className="flex flex-wrap items-center gap-2 px-6 py-4 md:px-8">
            <span className="text-muted-foreground text-sm font-medium">
              Post to
            </span>
            <button
              aria-pressed
              className="border-foreground text-foreground inline-flex h-8 items-center gap-2 rounded-full border ps-1 pe-3 text-sm font-medium"
              type="button"
            >
              <span className="bg-muted flex size-6 items-center justify-center rounded-full">
                <SocialPostProviderIcon
                  aria-hidden
                  className="size-3.5"
                  provider="x"
                />
              </span>
              <span>@sokosumi</span>
              <Check aria-hidden className="size-3.5" />
            </button>
          </div>
          <div className="space-y-3 border-t px-6 py-5 md:px-8">
            <textarea
              aria-label="Text"
              className="placeholder:text-muted-foreground field-sizing-content min-h-40 w-full resize-none border-0 bg-transparent px-0 text-base leading-relaxed shadow-none outline-none"
              defaultValue="Brand launch announcement"
              readOnly
            />
          </div>
          <div className="mt-auto flex justify-end gap-2 border-t px-6 py-4 md:px-8">
            <Button type="button">Save draft</Button>
          </div>
        </div>
      </TaskFormModal>
    </div>
  );
}

if (typeof document !== "undefined" && document.getElementById("fixture")) {
  const root = document.getElementById("fixture");
  if (root) {
    try {
      createRoot(root).render(<SocialComposeProjectSwitchPage />);
    } catch (error) {
      document.body.dataset.moduleError = String(error);
    }
  }
}
