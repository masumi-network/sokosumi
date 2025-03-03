import { AuthButtons } from "@/app/(landing)/components/auth-buttons";
import TextInputWithSubmit from "@/app/(landing)/components/input-with-button";
import { MainNav } from "@/app/(landing)/components/main-nav";
import TrustedPartners from "@/app/(landing)/components/trusted-partners";
import SokosumiLogo from "@/app/components/sokosumi-logo";

export default function LandingPage() {
  return (
    <>
      <div className="min-h-screen w-full bg-landing">
        <TopNavigation />
        <MainContent />
        <TextInputWithSubmit />
        <TrustedPartners />
      </div>
    </>
  );
}

function TopNavigation() {
  return (
    <div className="w-full px-8 py-4">
      <div className="container mx-auto flex items-center gap-6 justify-between">
        {/* Left - Logo */}
        <SokosumiLogo />

        {/* Middle - Navigation Links */}
        <MainNav />

        {/* Right - Auth Buttons */}
        <AuthButtons />
      </div>
    </div>
  );
}

function MainContent() {
  return (
    <div className="container mx-auto flex items-center justify-between px-4 py-16">
      <div className="flex flex-col items-center gap-8 lg:flex-row">
        {/* First text box - smaller width */}
        <div className="w-full lg:w-1/5">
          <p className="font-bold">
            The most powerful way to find and hire agents. Prompt, run, edit and
            deploy your agents.
          </p>
        </div>

        {/* Second text box - larger width */}
        <div className="mx-auto w-full lg:w-3/5">
          <p className={`font-light text-left text-7xl tracking-tighter`}>
            A marketplace for agent-to-agent interactions
          </p>
        </div>
      </div>
    </div>
  );
}
