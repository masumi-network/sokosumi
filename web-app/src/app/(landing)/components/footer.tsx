import { ArrowUpRightFromSquare, Languages } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import ThemeToggle from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export default function Footer() {
  return (
    <footer className="bg-background text-foreground">
      <div className="container mx-auto px-12 py-12">
        <div className="mb-20 grid grid-cols-1 gap-8 md:grid-cols-4">
          {/* NAVIGATE */}
          <div className="border-t pt-8">
            <h3 className="mb-4 font-medium">{"NAVIGATE"}</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/agents" className="hover:text-gray-300">
                  {"Agents Gallery"}
                </Link>
              </li>
              <li>
                <Link
                  href="https://github.com/masumi-network"
                  target="_blank"
                  className="hover:text-gray-300"
                >
                  {"Contribute"}
                </Link>
              </li>
            </ul>
          </div>

          {/* CONNECT */}
          <div className="border-t pt-8">
            <h3 className="mb-4 font-medium">{"CONNECT"}</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="https://x.com/MasumiNetwork"
                  className="hover:text-gray-300"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {"X/Twitter"}
                </Link>
              </li>
              <li>
                <Link
                  href="https://discord.com/invite/aj4QfnTS92"
                  className="hover:text-gray-300"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {"Discord"}
                </Link>
              </li>
            </ul>
          </div>

          {/* GET IN TOUCH */}
          <div className="border-t pt-8">
            <h3 className="mb-4 font-medium">{"GET IN TOUCH"}</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="https://www.masumi.network/contact"
                  target="_blank"
                  className="hover:text-gray-300"
                >
                  {"Contact"}
                </Link>
              </li>
            </ul>
          </div>

          {/* AGENTIC SERVICES */}
          <div className="border-t pt-8">
            <h3 className="mb-4 font-medium">{"AGENTIC SERVICES"}</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="https://masumi.network"
                  className="flex items-center gap-1 hover:text-gray-300"
                >
                  {"masumi"}
                  <ArrowUpRightFromSquare className="h-4 w-4" />
                </Link>
              </li>
              <li>
                <Link
                  href="https://kodosumi.io"
                  className="flex items-center gap-1 hover:text-gray-300"
                >
                  {"kodosumi"}
                  <ArrowUpRightFromSquare className="h-4 w-4" />
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom section */}
        <div className="flex flex-col items-center justify-between pt-8 md:flex-row">
          <div className="mb-4 flex items-center gap-4 md:mb-0">
            <ThemeToggle />
            <Button className="bg-quarterny text-foreground hover:bg-quarterny/90">
              <Languages className="h-4 w-4" />
              <span>{"English"}</span>
            </Button>
            <Link href="/imprint" className="text-sm hover:text-gray-300">
              {"Imprint"}
            </Link>
            <Link
              href="/privacy-policy"
              className="text-sm hover:text-gray-300"
            >
              {"Privacy Policy"}
            </Link>
            <Link
              href="/terms-of-services"
              className="text-sm hover:text-gray-300"
            >
              {"Terms & Conditions"}
            </Link>
          </div>
        </div>
      </div>

      {/* Footer image */}
      <div className="flex w-full justify-center">
        <Image
          className="w-full"
          src="/backgrounds/footer-image.png"
          alt="Footer"
          width={1920}
          height={1080}
        />
      </div>
    </footer>
  );
}
