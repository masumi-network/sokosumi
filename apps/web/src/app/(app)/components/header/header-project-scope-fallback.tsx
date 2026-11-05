/** The project selector while the frame or the session loads, in its place. */
export function HeaderProjectScopeFallback() {
  return (
    <div
      aria-hidden
      data-testid="header-project-scope-fallback"
      className="bg-muted h-8 w-36 animate-pulse rounded-md"
    />
  );
}
