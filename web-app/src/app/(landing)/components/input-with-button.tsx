"use client"

import { ArrowRight } from "lucide-react"
import type React from "react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function TextInputWithSubmit() {
  const [inputValue, setInputValue] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    console.log("Submitted:", inputValue)
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md mx-auto rounded-md">
      <div className="relative">
        <Input
          type="text"
          placeholder="Ask us about any agent service..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          className="pr-12 bg-white" // Add padding to the right to make room for the button
        />
        <Button
          type="submit"
          size="icon"
          className="absolute right-1 top-1 bottom-1 h-auto rounded-md bg-[#6401FF] hover:bg-[#5001CC] text-white"
          aria-label="Submit"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </form>
  )
}

