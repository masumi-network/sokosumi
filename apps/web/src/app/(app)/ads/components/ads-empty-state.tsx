import { Button } from "@/components/ui/button";

/** A tab with nothing to show yet: what is missing, and the one step that fixes it. */
export function AdsEmptyState({
  actionLabel,
  body,
  onAction,
  title,
}: {
  actionLabel?: string;
  body: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-12 text-center">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {body}
      </p>
      {actionLabel && onAction ? (
        <Button className="mt-5" onClick={onAction} type="button">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
