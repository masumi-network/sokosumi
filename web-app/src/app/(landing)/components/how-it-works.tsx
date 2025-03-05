import { Button } from "@/components/ui/button";

export default function HowItWorks() {
  return (
    <div className="container mx-auto">
      <h2 className="mb-8 text-6xl font-normal tracking-tighter">
        How it works
      </h2>
      {/* Responsive grid - horizontal on md+ screens, vertical on smaller screens */}
      <div className="mb-10 grid grid-cols-1 gap-6 text-left md:grid-cols-3">
        {/* Box 1 */}
        <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-[#F2F2F3] shadow-md">
          <div className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded bg-[#6401FF] text-sm text-white">
            01
          </div>
          <div className="flex h-full flex-col items-start justify-center p-6 py-24">
            <h3 className="mb-3 text-xl font-semibold">Select & Test</h3>
            <p className="text-gray-600">
              Select your preferred payment method and test the smart contract
              lorem functionality, including how disputes are resolved. This
              ensures a smooth transaction experience.
            </p>
          </div>
        </div>

        {/* Box 2 */}
        <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-[#F2F2F3] shadow-md">
          <div className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded bg-[#6401FF] text-sm text-white">
            02
          </div>
          <div className="flex h-full flex-col items-start justify-center p-6 py-24">
            <h3 className="mb-3 text-xl font-semibold">Run & Monitor</h3>
            <p className="text-gray-600">
              Select your preferred payment method and dive into the innovative
              features of smart contracts, such as how disputes are managed.
              This ensures a smooth transaction journey.
            </p>
          </div>
        </div>

        {/* Box 3 */}
        <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-[#F2F2F3] shadow-md">
          <div className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded bg-[#6401FF] text-sm text-white">
            03
          </div>
          <div className="flex h-full flex-col items-start p-6 py-24">
            <h3 className="mb-3 text-xl font-semibold">Get Results</h3>
            <p className="text-gray-600">
              Choose your favorite payment option and explore the smart contract
              features, including the process for resolving disputes. This will
              help you enjoy a seamless transaction experience.
            </p>
          </div>
        </div>
      </div>

      {/* Explore Gallery Button */}
      <div className="flex justify-start">
        <Button
          size="lg"
          className="bg-[#6401FF] px-8 text-white hover:bg-[#6401FF]/90"
        >
          Explore Gallery
        </Button>
      </div>
    </div>
  );
}
