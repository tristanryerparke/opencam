import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const inputVariants = cva(
  "w-full min-w-0 rounded-md border border-input bg-transparent transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:border-0 file:bg-transparent file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-30 dark:bg-input/20",
  {
    variants: {
      size: {
        default: "h-6 px-2 py-1 text-xs file:h-5 file:text-xs",
        xs: "h-6 px-2 py-1 text-xs file:h-5 file:text-xs",
        sm: "h-8 px-2 py-1 text-sm file:h-6 file:text-sm",
        lg: "h-10 px-2 py-2 text-base file:h-8 file:text-base",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function Input({
  className,
  type,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"input">, "size"> &
  VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(
        inputVariants({ size, className }),
        "focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40"
      )}
      {...props}
    />
  )
}

export { Input, inputVariants }
