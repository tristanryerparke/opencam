import { ChevronDown, ChevronUp } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  NumericFormat,
  type NumberFormatValues,
  type SourceInfo,
} from "react-number-format";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface NumberInputProps {
  value?: number;
  onValueChange?: (value: number | undefined) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
  decimalScale?: number;
  step?: number;
  min?: number;
  max?: number;
  allowNegative?: boolean;
  coerceValue?: (value: number | undefined) => number | undefined;
}

function getDisplayValue(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

export default memo(function NumberInput({
  value,
  onValueChange,
  disabled = false,
  invalid = false,
  placeholder = "Enter number",
  className,
  decimalScale,
  step = 1,
  min,
  max,
  allowNegative = true,
  coerceValue,
}: NumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draftValue, setDraftValue] = useState(() => getDisplayValue(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(getDisplayValue(value));
    }
  }, [isFocused, value]);

  const normalizeValue = useCallback(
    (nextValue: number | undefined) => {
      let normalized = coerceValue ? coerceValue(nextValue) : nextValue;

      if (normalized === undefined) {
        return undefined;
      }
      if (min !== undefined && normalized < min) {
        return undefined;
      }
      if (max !== undefined && normalized > max) {
        return undefined;
      }

      return normalized;
    },
    [coerceValue, max, min],
  );

  const handleIncrement = useCallback(() => {
    const baseValue = value ?? 0;
    const nextValue = normalizeValue(baseValue + step);
    setDraftValue(getDisplayValue(nextValue));
    onValueChange?.(nextValue);
  }, [normalizeValue, onValueChange, step, value]);

  const handleDecrement = useCallback(() => {
    const baseValue = value ?? 0;
    const nextValue = normalizeValue(baseValue - step);
    setDraftValue(getDisplayValue(nextValue));
    onValueChange?.(nextValue);
  }, [normalizeValue, onValueChange, step, value]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.activeElement !== inputRef.current) {
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        handleIncrement();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        handleDecrement();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleDecrement, handleIncrement]);

  const handleValueChange = useCallback(
    (values: NumberFormatValues, sourceInfo: SourceInfo) => {
      const eventTarget = sourceInfo.event?.target as HTMLInputElement | null;
      const nextDraftValue =
        sourceInfo.source === "event" && eventTarget
          ? eventTarget.value
          : values.formattedValue;
      const nextValue = normalizeValue(values.floatValue);

      setDraftValue(nextDraftValue);

      if (sourceInfo.source === "event") {
        onValueChange?.(nextValue);
      }
    },
    [normalizeValue, onValueChange],
  );

  return (
    <div
      className={cn(
        "flex h-7 flex-1 items-center overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow]",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        invalid && "border-destructive focus-within:border-destructive",
        disabled && "opacity-50",
        className,
      )}
    >
      <NumericFormat
        value={draftValue}
        onValueChange={handleValueChange}
        decimalScale={decimalScale}
        allowNegative={allowNegative}
        aria-invalid={invalid}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        customInput={Input}
        placeholder={placeholder}
        className="relative h-full rounded-none border-0 shadow-none [appearance:textfield] focus-visible:border-transparent focus-visible:ring-0 aria-invalid:border-0 aria-invalid:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        getInputRef={inputRef}
        disabled={disabled}
      />
      <div className="flex h-7 flex-col">
        <Button
          aria-label="Increase value"
          className="h-3.5 min-h-0 w-4 rounded-none border-0 border-b border-l border-input bg-transparent px-0.5 py-0 shadow-none focus-visible:relative focus-visible:border-input focus-visible:ring-0"
          variant="outline"
          type="button"
          onClick={handleIncrement}
          disabled={disabled}
        >
          <ChevronUp size={8} />
        </Button>
        <Button
          aria-label="Decrease value"
          className="h-3.5 min-h-0 w-4 rounded-none border-0 border-l border-input bg-transparent px-0.5 py-0 shadow-none focus-visible:relative focus-visible:border-input focus-visible:ring-0"
          variant="outline"
          type="button"
          onClick={handleDecrement}
          disabled={disabled}
        >
          <ChevronDown size={8} />
        </Button>
      </div>
    </div>
  );
});
