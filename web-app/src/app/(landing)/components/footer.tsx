import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { DiscordButton, XButton } from "./social-button";

export default function Footer() {
  return (
    <footer className="bg-black text-white">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {/* First column - top: Social Media */}
          <div>
            <h3 className="text-lg font-medium text-muted-foreground">
              Join our community
            </h3>
            <div className="mt-4 flex space-x-4">
              <XButton />
              <DiscordButton />
            </div>
          </div>

          {/* Second column - top: Vertical list of links) */}
          <div>
            <nav>
              <ul className="space-y-2">
                <li>
                  <Link
                    href="#"
                    className="flex items-center gap-1 text-xl hover:text-muted-foreground"
                  >
                    <ArrowRight className="h-4 w-4" />
                    <span>Home</span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="#agents-gallery"
                    className="flex items-center gap-1 text-xl hover:text-muted-foreground"
                  >
                    <ArrowRight className="h-4 w-4" />
                    <span>Gallery</span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="#how-it-works"
                    className="flex items-center gap-1 text-xl hover:text-muted-foreground"
                  >
                    <ArrowRight className="h-4 w-4" />
                    <span>How it Works</span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="#contribute"
                    className="flex items-center gap-1 text-xl hover:text-muted-foreground"
                  >
                    <ArrowRight className="h-4 w-4" />
                    <span>Contribute</span>
                  </Link>
                </li>
              </ul>
            </nav>
          </div>

          {/* First column - bottom: Copyright */}
          <div>
            <p className="text-sm text-muted-foreground">
              Masumi AG &copy; {new Date().getFullYear()} All rights reserved.
            </p>
          </div>

          {/* Second column - bottom: Horizontal list of links */}
          <div>
            <ul className="flex flex-wrap space-x-4">
              <li>
                <Link
                  href="#"
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-white"
                >
                  Imprint
                </Link>
              </li>
              <li>
                <Link
                  href="#"
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-white"
                >
                  Contact
                </Link>
              </li>
              <li>
                <Link
                  href="#"
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-white"
                >
                  Privacy Policy
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
