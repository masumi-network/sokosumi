"use client";

import { useEffect, useState } from "react";

export default function HeaderBlur() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 100);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  if (!isScrolled) return null;

  return (
    <div
      className="bg-background/2 fixed top-0 left-0 -z-10 h-[72px] w-full backdrop-blur-sm lg:h-[84px]"
      style={{
        clipPath: "inset(0 0 0 0)",
      }}
    />
  );
}
