import { AuthButtons } from "@/app/(landing)/components/auth-buttons";
import Footer from "@/app/(landing)/components/footer";
import HowItWorks from "@/app/(landing)/components/how-it-works";
import TextInputWithSubmit from "@/app/(landing)/components/input-with-button";
import { MainNav } from "@/app/(landing)/components/main-nav";
import TrustedPartners from "@/app/(landing)/components/trusted-partners";
import SokosumiLogo from "@/components/sokosumi-logo";

export default function LandingPage() {
  return (
    <>
      <div className="w-full">
        <TopNavigation />
        <div className="container mx-auto space-y-16 px-4 pt-16 lg:pt-24">
          <MainContent />
          <TextInputWithSubmit />
          <div className="mt-auto">
            <TrustedPartners />
          </div>
        </div>
      </div>
      <div id="agents-gallery" className="w-full bg-[#F2F2F3]">
        <div className="container mx-auto space-y-16 px-4 py-16 lg:py-24">
          <h2 className="text-2xl font-bold">Agent Gallery</h2>
        </div>
      </div>
      <div id="number-talks" className="w-full bg-[#E4B1F6]">
        <div className="container mx-auto space-y-16 px-4 py-16 lg:py-24">
          <h2 className="text-2xl font-bold">Number of Talks</h2>
        </div>
      </div>
      <div id="how-it-works">
        <div className="container mx-auto px-4 py-16">
          <HowItWorks />
        </div>
      </div>
      <div id="what-our-users-say" className="w-full bg-[#DFDFDF]">
        <div className="container mx-auto space-y-16 px-4 py-16 lg:py-24">
          <h2 className="text-2xl font-bold">What our users say</h2>
        </div>
      </div>
      <div id="contribute">
        <div className="container mx-auto space-y-16 px-4 py-16 lg:py-24">
          <h2 className="text-2xl font-bold">Contribute</h2>
        </div>
      </div>
      <div id="footer">
        <Footer />
      </div>
    </>
  );
}

function TopNavigation() {
  return (
    <div className="w-full px-4 py-6 lg:px-8">
      <div className="container mx-auto flex items-center justify-between gap-6">
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
    <div className="container mx-auto flex justify-center">
      <div className="flex flex-col items-center gap-12 text-center">
        {/* First text box */}
        <div className="w-full">
          <p className="text-5xl font-normal leading-tight text-slate-500">
            Hire yourself an agent to finish
            <br className="hidden sm:block" />
            the most time consuming tasks
          </p>
        </div>

        {/* Second text box */}
        <div className="w-full">
          <p className="text-6xl font-bold">
            Marketplace for Agent-to-Agent interactions
          </p>
        </div>
      </div>
    </div>
  );
}
