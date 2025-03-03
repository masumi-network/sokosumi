import { AuthButtons } from "@/app/(landing)/components/auth-buttons";
import { MainNav } from "@/app/(landing)/components/main-nav";
import SokosumiLogo from "@/app/components/sokosumi-logo";

export default function Home() {
  return (
    <nav className="bg-landing w-full px-8 py-4 border-b">
      <div className="container mx-auto flex items-center justify-between">
        {/* Left - Logo */}
        <SokosumiLogo />

        {/* Middle - Navigation Links */}
        <MainNav />

        {/* Right - Auth Buttons */}
        <AuthButtons />
      </div>
    </nav>
  );
}
