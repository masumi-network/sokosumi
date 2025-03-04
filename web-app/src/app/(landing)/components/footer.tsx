import { ArrowRight, ArrowUpRight } from "lucide-react"
import Link from "next/link"

import { DiscordButton,XButton } from "./social-button"

export default function Footer() {
  return (
    <footer className="bg-black text-white">
      <div className="container px-4 py-12 mx-auto">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {/* First column - top: Social Media */}
          <div>
            <h3 className="text-lg font-medium text-muted-foreground">Join our community</h3>
            <div className="flex mt-4 space-x-4">
              <XButton />
              <DiscordButton />
            </div>
          </div>

          {/* Second column - top: Vertical list of links) */}
          <div>
            <nav>
              <ul className="space-y-2">
                <li>
                  <Link href="#" className="text-xl hover:text-muted-foreground flex items-center gap-1">
                    <ArrowRight className="w-4 h-4" />
                    <span>Home</span>
                  </Link>
                </li>
                <li>
                  <Link href="#agents-gallery" className="text-xl hover:text-muted-foreground flex items-center gap-1">
                    <ArrowRight className="w-4 h-4" />
                    <span>Gallery</span>
                  </Link>
                </li>
                <li>
                  <Link href="#how-it-works" className="text-xl hover:text-muted-foreground flex items-center gap-1">
                    <ArrowRight className="w-4 h-4" />
                    <span>How it Works</span>
                  </Link>
                </li>
                <li>
                  <Link href="#contribute" className="text-xl hover:text-muted-foreground flex items-center gap-1">
                    <ArrowRight className="w-4 h-4" />
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
                <Link href="#" className="text-sm text-muted-foreground hover:text-white flex items-center gap-1">
                  Imprint
                </Link>
              </li>
              <li>
                <Link href="#" className="text-sm text-muted-foreground hover:text-white flex items-center gap-1">
                  Contact
                </Link>
              </li>
              <li>
                <Link href="#" className="text-sm text-muted-foreground hover:text-white flex items-center gap-1">
                  Privacy Policy<ArrowUpRight className="w-4 h-4" />
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  )
}


