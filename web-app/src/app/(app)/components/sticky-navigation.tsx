import NavMenu from "./nav-menu";

export default function StickyNavigation() {
  return (
    <nav className="mx-4 hidden flex-1 md:block">
      <NavMenu className="flex-row justify-end gap-4 text-sm lg:gap-6" />
    </nav>
  );
}
