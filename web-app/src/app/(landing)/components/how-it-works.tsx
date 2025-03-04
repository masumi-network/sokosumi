import { Button } from "@/components/ui/button"

export default function HowItWorks() {
  return (
    <div className="container mx-auto">
      <h2 className="text-6xl font-normal mb-8 tracking-tighter">How it works</h2>
      {/* Responsive grid - horizontal on md+ screens, vertical on smaller screens */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10 text-left">
        {/* Box 1 */}
        <div className="relative bg-[#F2F2F3] rounded-lg shadow-md overflow-hidden border border-gray-200">
          <div className="absolute text-sm top-2 left-2 bg-[#6401FF] text-white w-8 h-8 flex items-center justify-center rounded">
            01
          </div>
          <div className="p-6 py-24 flex flex-col items-start justify-center h-full">
            <h3 className="text-xl font-semibold mb-3">Select & Test</h3>
            <p className="text-gray-600">
              Select your preferred payment method and test the smart contract lorem functionality, including how disputes are resolved. This ensures a smooth transaction experience.
            </p>
          </div>
        </div>

        {/* Box 2 */}
        <div className="relative bg-[#F2F2F3] rounded-lg shadow-md overflow-hidden border border-gray-200">
          <div className="absolute text-sm top-2 left-2 bg-[#6401FF] text-white w-8 h-8 flex items-center justify-center rounded">
            02
          </div>
          <div className="p-6 py-24 flex flex-col items-start justify-center h-full">
            <h3 className="text-xl font-semibold mb-3">Run & Monitor</h3>
            <p className="text-gray-600">
              Select your preferred payment method and dive into the innovative features of smart contracts, such as how disputes are managed. This ensures a smooth transaction journey.
            </p>
          </div>
        </div>

        {/* Box 3 */}
        <div className="relative bg-[#F2F2F3] rounded-lg shadow-md overflow-hidden border border-gray-200">
          <div className="absolute text-sm top-2 left-2 bg-[#6401FF] text-white w-8 h-8 flex items-center justify-center rounded">
            03
          </div>
          <div className="p-6 py-24 flex flex-col items-start h-full">
            <h3 className="text-xl font-semibold mb-3">Get Results</h3>
            <p className="text-gray-600">
              Choose your favorite payment option and explore the smart contract features, including the process for resolving disputes. This will help you enjoy a seamless transaction experience.
            </p>
          </div>
        </div>
      </div>

      {/* Explore Gallery Button */}
      <div className="flex justify-start">
        <Button size="lg" className="px-8 bg-[#6401FF] hover:bg-[#6401FF]/90 text-white">
          Explore Gallery
        </Button>
      </div>
    </div>
  )
}

