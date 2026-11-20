import { ArrowLeft } from "lucide-react";
import Link from "next/link";

/** Back to Archived, on an archived Task and in its loading shell. */
export function ArchivedTaskBackLink({ label }: { label: string }) {
  return (
    <Link
      href="/tasks/archived"
      className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}
