"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface ColorPickerProps {
  value?: string
  onChange?: (color: string) => void
  onBlur?: () => void
  disabled?: boolean
  className?: string
  label?: string
  placeholder?: string
}

const ColorPicker = React.forwardRef<HTMLInputElement, ColorPickerProps>(
  ({ value = "#000000", onChange, onBlur, disabled, className, label, placeholder = "Select color" }, ref) => {
    const [internalValue, setInternalValue] = React.useState(value)
    const [isOpen, setIsOpen] = React.useState(false)

    // Sync internal value with prop value
    React.useEffect(() => {
      setInternalValue(value)
    }, [value])

    const handleColorChange = (newColor: string) => {
      setInternalValue(newColor)
      onChange?.(newColor)
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newColor = e.target.value
      handleColorChange(newColor)
    }

    const handleColorInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newColor = e.target.value
      handleColorChange(newColor)
    }

    // Predefined color palette
    const presetColors = [
      "#000000",
      "#ffffff",
      "#ef4444",
      "#f97316",
      "#eab308",
      "#22c55e",
      "#06b6d4",
      "#3b82f6",
      "#8b5cf6",
      "#ec4899",
      "#6b7280",
      "#f3f4f6",
    ]

    return (
      <div className={cn("space-y-2", className)}>
        {label && (
          <Label htmlFor="color-input" className="text-sm font-medium">
            {label}
          </Label>
        )}
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              disabled={disabled}
              className={cn("w-full justify-start text-left font-normal", !internalValue && "text-muted-foreground")}
            >
              <div className="mr-2 h-4 w-4 rounded border border-border" style={{ backgroundColor: internalValue }} />
              {internalValue || placeholder}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <div className="space-y-3">
              {/* Color input */}
              <div className="flex items-center space-x-2">
                <input
                  ref={ref}
                  id="color-input"
                  type="color"
                  value={internalValue}
                  onChange={handleColorInputChange}
                  onBlur={onBlur}
                  disabled={disabled}
                  className="h-8 w-16 rounded border border-border bg-transparent cursor-pointer disabled:cursor-not-allowed"
                />
                <Input
                  value={internalValue}
                  onChange={handleInputChange}
                  onBlur={onBlur}
                  disabled={disabled}
                  placeholder="#000000"
                  className="flex-1 font-mono text-sm"
                />
              </div>

              {/* Preset colors */}
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-2 block">Preset Colors</Label>
                <div className="grid grid-cols-6 gap-2">
                  {presetColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => handleColorChange(color)}
                      disabled={disabled}
                      className={cn(
                        "h-8 w-8 rounded border-2 transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50",
                        internalValue === color
                          ? "border-ring ring-2 ring-ring ring-offset-2 ring-offset-background"
                          : "border-border hover:border-ring",
                      )}
                      style={{ backgroundColor: color }}
                      aria-label={`Select color ${color}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    )
  },
)

ColorPicker.displayName = "ColorPicker"

export { ColorPicker }
