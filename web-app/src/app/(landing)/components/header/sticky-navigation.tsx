import NavigationMenu from "./navigation-menu";

export default function StickyNavigation() {
  return (
    <nav className="mx-4 hidden flex-1 md:block">
      <NavigationMenu className="flex-row items-center justify-center gap-x-6 text-sm font-medium" />
    </nav>
  );
}
