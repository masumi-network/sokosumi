import NavigationMenu from "./navigation-menu";

export default function Navigation() {
  return (
    <nav className="mx-4 block flex-1">
      <NavigationMenu className="flex-row items-center justify-center gap-x-6 text-xs md:text-base" />
    </nav>
  );
}
