import { renderToStaticMarkup } from "react-dom/server";

import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";

const showPhotoBadge = process.argv[2] !== "before";

const X_PHOTO =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" fill="#111827"/><circle cx="32" cy="24" r="10" fill="#f8fafc"/><rect x="16" y="38" width="32" height="14" rx="7" fill="#f8fafc"/></svg>`,
  );
const LINKEDIN_PHOTO =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" fill="#0f766e"/><circle cx="32" cy="24" r="10" fill="#ecfdf5"/><rect x="16" y="38" width="32" height="14" rx="7" fill="#ecfdf5"/></svg>`,
  );

function ChipLogo({
  className,
  provider,
}: {
  className: string;
  provider: "linkedin" | "x";
}) {
  return (
    <SocialPostProviderIcon
      aria-hidden
      className={className}
      provider={provider}
    />
  );
}

function ChipMark({ provider }: { provider: "linkedin" | "x" }) {
  if (!showPhotoBadge) {
    return (
      <span className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full">
        <ChipLogo className="size-3.5" provider={provider} />
      </span>
    );
  }

  const src = provider === "x" ? X_PHOTO : LINKEDIN_PHOTO;
  return (
    <span className="relative size-6 shrink-0">
      <span className="relative flex size-6 shrink-0 overflow-hidden rounded-full">
        <img
          alt=""
          className="absolute inset-0 aspect-square size-full object-cover"
          src={src}
        />
      </span>
      <span className="bg-background ring-background absolute end-0 bottom-0 flex size-3 items-center justify-center rounded-full ring-1">
        <ChipLogo className="size-2" provider={provider} />
      </span>
    </span>
  );
}

function PreviewAccountChips() {
  return (
    <div
      className="bg-background-muted w-80 space-y-3 rounded-lg border p-4"
      data-testid="preview-account-chips"
    >
      <p className="text-muted-foreground text-xs font-medium">Preview</p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="border-foreground text-foreground inline-flex h-8 shrink-0 items-center gap-2 rounded-full border ps-1 pe-3 text-sm font-medium">
          <ChipMark provider="x" />
          <span className="max-w-32 truncate">@sokosumi</span>
        </span>
        <span className="text-muted-foreground inline-flex h-8 shrink-0 items-center gap-2 rounded-full border ps-1 pe-3 text-sm font-medium">
          <ChipMark provider="linkedin" />
          <span className="max-w-32 truncate">@sokosumi-co</span>
        </span>
      </div>
    </div>
  );
}

process.stdout.write(renderToStaticMarkup(<PreviewAccountChips />));
