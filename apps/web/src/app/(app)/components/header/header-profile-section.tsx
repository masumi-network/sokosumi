import { HeaderTrailingTools } from "./header-trailing-tools";

/** Trailing notification control; workspace and actions live in the header. */
export default function HeaderProfileSection() {
  return (
    <div className="flex h-8 items-center gap-1.5 md:h-auto">
      <HeaderTrailingTools />
    </div>
  );
}
