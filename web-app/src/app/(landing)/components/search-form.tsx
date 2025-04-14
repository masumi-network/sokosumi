"use client";

import { ArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function SearchForm() {
  return (
    <form className="relative" onSubmit={(e) => e.preventDefault()}>
      <div className="relative">
        <input
          type="text"
          placeholder="Search agents"
          className="text-small h-[60px] w-full rounded-xl border border-white/5 bg-black/50 px-8 pr-24 text-white/60 shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.10),0px_2px_4px_-1px_rgba(0,0,0,0.06)] backdrop-blur-sm placeholder:text-white/60 focus:outline-none"
        />
        <Button
          type="submit"
          className="bg-quinary hover:bg-quinary/80 absolute top-1/2 right-4 -translate-y-1/2 p-4 text-white/60 transition-colors hover:text-white"
          variant="secondary"
        >
          <ArrowUp className="h-6 w-6" />
        </Button>
      </div>
    </form>
  );
}
