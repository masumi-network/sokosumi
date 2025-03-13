import { SokosumiLogo } from "@/components/masumi-logos";

import AuthButton from "./auth-button";

export default function Header() {
  return (
    <div id="header" className="w-full px-4 py-6 lg:px-8">
      <div className="container mx-auto flex items-center justify-between gap-6">
        {/* Left - Logo */}
        <SokosumiLogo />

        {/* Middle - Navigation Links */}
        {/* <Navigation /> */}

        {/* Right - Auth Button */}
        <AuthButton />
      </div>
    </div>
  );
}
