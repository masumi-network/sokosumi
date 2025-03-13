import { SignInButton, SignUpButton } from "@/app/(auth)/buttons";
import MainNavigation from "@/components/main-navigation";
import { SokosumiLogo } from "@/components/masumi-logos";

export default function Header() {
  return (
    <div id="header" className="w-full px-4 py-6 lg:px-8">
      <div className="container mx-auto flex items-center justify-between gap-6">
        {/* Left - Logo */}
        <SokosumiLogo />

        {/* Middle - Navigation Links */}
        <MainNavigation />

        {/* Right - Auth Buttons */}
        <AuthButtons />
      </div>
    </div>
  );
}

function AuthButtons() {
  return (
    <div className="flex items-center gap-4">
      <SignInButton variant="outline" />
      <SignUpButton />
    </div>
  );
}
