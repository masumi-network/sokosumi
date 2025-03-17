import NavigationMenu from "./navigation-menu";

export default function Navigation() {
  return (
    <nav className="mx-4 hidden flex-1 lg:block">
      <NavigationMenu className="flex-row items-center justify-center gap-x-6" />
    </nav>
  );
}
