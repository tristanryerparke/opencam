import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const labelVariants = cva(
  "flex items-center leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-30 peer-disabled:cursor-not-allowed peer-disabled:opacity-30",
  {
    variants: {
      size: {
        default: "gap-2 text-sm",
        xs: "gap-1 text-xs",
        sm: "gap-1.5 text-sm",
        lg: "gap-2 text-base",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function Label({
  className,
  size = "xs",
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> &
  VariantProps<typeof labelVariants>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      data-size={size}
      className={cn(labelVariants({ size, className }))}
      {...props}
    />
  )
}

export { Label, labelVariants }
