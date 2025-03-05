"use client";

import { ArrowRight } from "lucide-react";
import type React from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function TextInputWithSubmit() {
  const [inputValue, setInputValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Submitted:", inputValue);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto w-full max-w-md rounded-md"
    >
      <div className="relative">
        <Input
          type="text"
          placeholder="Ask us about any agent service..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          className="bg-white pr-12" // Add padding to the right to make room for the button
        />
        <Button
          type="submit"
          size="icon"
          className="absolute bottom-1 right-1 top-1 h-auto rounded-md bg-[#6401FF] text-white hover:bg-[#6401FF]/90"
          aria-label="Submit"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
