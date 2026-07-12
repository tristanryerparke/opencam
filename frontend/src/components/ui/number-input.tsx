import { ChevronDown, ChevronUp } from "lucide-react"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import {
  NumericFormat,
  type NumberFormatValues,
  type SourceInfo,
} from "react-number-format"

import { Button } from "t-components/button"
import { Input } from "t-components/input"
import { cn } from "@/lib/utils"

export interface NumberInputProps {
  id?: string
  value?: number
  onValueChange?: (value: number | undefined) => void
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  className?: string
  decimalScale?: number
  step?: number
  min?: number
  max?: number
  allowNegative?: boolean
  coerceValue?: (value: number | undefined) => number | undefined
}

function getDisplayValue(value: number | undefined): string {
  return value === undefined ? "" : String(value)
}

export const NumberInput = memo(function NumberInput({
  id,
  value,
  onValueChange,
  disabled = false,
  invalid = false,
  placeholder = "Enter number",
  className,
  decimalScale = 0,
  step = 1,
  min,
  max,
  allowNegative = true,
  coerceValue,
}: NumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draftValue, setDraftValue] = useState(() => getDisplayValue(value))
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(getDisplayValue(value))
    }
  }, [isFocused, value])

  const normalizeValue = useCallback(
    (nextValue: number | undefined) => {
      const normalized = coerceValue ? coerceValue(nextValue) : nextValue

      if (normalized === undefined) {
        return undefined
      }
      if (min !== undefined && normalized < min) {
        return undefined
      }
      if (max !== undefined && normalized > max) {
        return undefined
      }

      return normalized
    },
    [coerceValue, max, min]
  )

  const handleIncrement = useCallback(() => {
    const nextValue = value === undefined ? step : value + step
    setDraftValue(String(nextValue))
    onValueChange?.(normalizeValue(nextValue))
  }, [normalizeValue, onValueChange, step, value])

  const handleDecrement = useCallback(() => {
    const nextValue = value === undefined ? -step : value - step
    setDraftValue(String(nextValue))
    onValueChange?.(normalizeValue(nextValue))
  }, [normalizeValue, onValueChange, step, value])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement !== inputRef.current) {
        return
      }

      if (e.key === "ArrowUp") {
        e.preventDefault()
        handleIncrement()
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        handleDecrement()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleDecrement, handleIncrement])

  const handleValueChange = useCallback(
    (values: NumberFormatValues, sourceInfo: SourceInfo) => {
      const eventTarget = sourceInfo.event?.target as HTMLInputElement | null
      const nextDraftValue =
        sourceInfo.source === "event" && eventTarget
          ? eventTarget.value
          : values.formattedValue
      const nextValue = normalizeValue(values.floatValue)

      setDraftValue(nextDraftValue)

      if (sourceInfo.source === "event") {
        onValueChange?.(nextValue)
      }
    },
    [normalizeValue, onValueChange]
  )

  return (
    <div
      data-disabled={disabled}
      className={cn(
        "flex items-center rounded-md border border-input bg-transparent transition-[color,box-shadow] dark:bg-input/20 data-[disabled=true]:opacity-30",
        isFocused && "border-ring ring-[2px] ring-ring/50",
        invalid && !disabled && "border-destructive",
        invalid && !disabled && isFocused && "border-destructive ring-destructive/20 dark:ring-destructive/40",
        className
      )}
    >
      <NumericFormat
        id={id}
        value={draftValue}
        onValueChange={handleValueChange}
        decimalScale={decimalScale}
        allowNegative={allowNegative}
        aria-invalid={invalid}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        customInput={Input}
        placeholder={placeholder}
        className="rounded-l-md rounded-r-none !bg-transparent dark:!bg-transparent border-0 disabled:opacity-100 focus-visible:!border-transparent focus-visible:!ring-0 aria-invalid:border-0 aria-invalid:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        getInputRef={inputRef}
        disabled={disabled}
      />
      <div className="flex h-6 flex-col">
        <Button
          aria-label="Increase value"
          className="h-3 w-4 min-h-0 rounded-none rounded-tr-md border-0 border-l border-b border-input bg-transparent px-0 py-0 disabled:opacity-100 focus-visible:relative focus-visible:z-10 focus-visible:border-ring focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-[2px] focus-visible:ring-ring/50"
          variant="outline"
          onClick={handleIncrement}
          disabled={disabled}
          type="button"
        >
          <ChevronUp size={9} />
        </Button>
        <Button
          aria-label="Decrease value"
          className="h-3 w-4 min-h-0 rounded-none rounded-br-md border-0 border-l border-input bg-transparent px-0 py-0 disabled:opacity-100 focus-visible:relative focus-visible:z-10 focus-visible:border-ring focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-[2px] focus-visible:ring-ring/50"
          variant="outline"
          onClick={handleDecrement}
          disabled={disabled}
          type="button"
        >
          <ChevronDown size={9} />
        </Button>
      </div>
    </div>
  )
})

export default NumberInput
