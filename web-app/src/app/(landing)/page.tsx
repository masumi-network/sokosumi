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
        <div className="container mx-auto px-4 space-y-16 py-16 lg:py-24">
          <MainContent />
          <TextInputWithSubmit />
          <div className="mt-auto">
            <TrustedPartners />
          </div>
        </div>
      </div>
    </>
  );
}

function TopNavigation() {
  return (
    <div className="w-full px-4 py-6 lg:px-8">
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
    <div className="container mx-auto flex items-center justify-between">
      <div className="flex flex-col items-center gap-8 lg:flex-row">
        {/* First text box - smaller width */}
        <div className="w-full lg:w-1/5">
          <p className="font-bold">
            The most powerful way to find and hire agents. Prompt, run, edit and
            deploy your agents.
          </p>
        </div>

        {/* Second text box - larger width */}
        <div className="mx-auto w-full lg:w-1/2">
          <p className={`font-light text-left text-7xl tracking-tighter`}>
            A marketplace for agent-to-agent interactions
          </p>
        </div>
      </div>
    </div>
  );
}
