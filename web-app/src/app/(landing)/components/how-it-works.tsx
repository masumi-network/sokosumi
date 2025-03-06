import Image from "next/image";

import { Button } from "@/components/ui/button";

export default function HowItWorks() {
  return (
    <>
      {/* Responsive grid - horizontal on md+ screens, vertical on smaller screens */}
      <div className="mb-10 grid grid-cols-1 gap-8 text-left md:grid-cols-3">
        {/* Step 1 */}
        <div className="flex h-full w-full flex-col items-start">
          <div className="flex h-full w-full flex-col">
            <h3 className="mb-3 text-xl font-semibold">Select & Test</h3>
            <p className="mb-4 flex-grow text-gray-600">
              Select your preferred payment method and test the smart contract
              functionality, including how disputes are resolved. This ensures a
              smooth transaction experience.
            </p>
            <div className="relative h-48 w-full overflow-hidden rounded-lg">
              <Image
                src="/placeholder.svg"
                alt="Select & Test illustration"
                fill
                className="object-cover"
              />
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div className="flex h-full w-full flex-col items-start">
          <div className="flex h-full w-full flex-col">
            <h3 className="mb-3 text-xl font-semibold">Run & Monitor</h3>
            <p className="mb-4 flex-grow text-gray-600">
              Select your preferred payment method and dive into the innovative
              features of smart contracts, such as how disputes are managed.
              This ensures a smooth transaction journey.
            </p>
            <div className="relative h-48 w-full overflow-hidden rounded-lg">
              <Image
                src="/placeholder.svg"
                alt="Run & Monitor illustration"
                fill
                className="object-cover"
              />
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div className="flex h-full w-full flex-col items-start">
          <div className="flex h-full w-full flex-col">
            <h3 className="mb-3 text-xl font-semibold">Get Results</h3>
            <p className="mb-4 flex-grow text-gray-600">
              Choose your favorite payment option and explore the smart contract
              features, including the process for resolving disputes. This will
              help you enjoy a seamless transaction experience.
            </p>
            <div className="relative h-48 w-full overflow-hidden rounded-lg">
              <Image
                src="/placeholder.svg"
                alt="Get Results illustration"
                fill
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Explore Gallery Button */}
      <div className="flex justify-start">
        <Button>Explore Gallery</Button>
      </div>
    </>
  );
}
