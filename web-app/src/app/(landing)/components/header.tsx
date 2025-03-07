import Link from "next/link";

import { SokosumiLogo } from "@/components/masumi-logos";
import { Button } from "@/components/ui/button";

import Navigation from "./navigation";

export default function Header() {
  return (
    <div id="header" className="w-full px-4 py-6 lg:px-8">
      <div className="container mx-auto flex items-center justify-between gap-6">
        {/* Left - Logo */}
        <SokosumiLogo />

        {/* Middle - Navigation Links */}
        <Navigation />

        {/* Right - Auth Buttons */}
        <AuthButtons />
      </div>
    </div>
  );
}

export function AuthButtons() {
  return (
    <div className="flex items-center gap-4">
      <Link href="/signin">
        <Button variant="outline">Sign In</Button>
      </Link>
      <Link href="/signup">
        <Button>Sign Up</Button>
      </Link>
    </div>
  );
}
