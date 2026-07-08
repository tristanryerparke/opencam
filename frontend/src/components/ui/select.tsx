import * as React from "react"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

type SelectSize = "default" | "xs" | "sm" | "lg"

const SelectSizeContext = React.createContext<SelectSize>("default")

const selectTriggerVariants = cva(
  "flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent transition-[color,box-shadow] outline-none data-[placeholder]:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-30 dark:bg-input/20 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='text-'])]:text-muted-foreground",
  {
    variants: {
      size: {
        default: "h-6 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        xs: "h-6 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 px-2 text-sm [&_svg:not([class*='size-'])]:size-4",
        lg: "h-10 px-2 text-base [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const selectContentVariants = cva(
  "relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border border-input bg-background text-foreground data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
  {
    variants: {
      size: {
        default: "text-xs",
        xs: "text-xs",
        sm: "text-sm",
        lg: "text-base",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const selectViewportVariants = cva("", {
  variants: {
    size: {
      default: "p-0.5",
      xs: "p-0.5",
      sm: "p-1",
      lg: "p-1.5",
    },
  },
  defaultVariants: {
    size: "default",
  },
})

const selectLabelVariants = cva("text-muted-foreground", {
  variants: {
    size: {
      default: "px-2 py-1 text-xs",
      xs: "px-2 py-1 text-xs",
      sm: "px-2 py-1 text-sm",
      lg: "px-2 py-1.5 text-base",
    },
  },
  defaultVariants: {
    size: "default",
  },
})

const selectItemVariants = cva(
  "relative flex w-full cursor-default items-center gap-2 rounded-sm outline-hidden select-none hover:bg-foreground/30 focus:bg-foreground/10 focus:text-foreground dark:hover:bg-foreground/20 dark:focus:bg-foreground/20 data-[disabled]:pointer-events-none data-[disabled]:opacity-30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
  {
    variants: {
      size: {
        default: "min-h-6 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        xs: "min-h-6 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "min-h-8 px-2 text-sm [&_svg:not([class*='size-'])]:size-4",
        lg: "min-h-10 px-2 text-base [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const selectScrollButtonVariants = cva(
  "flex cursor-default items-center justify-center",
  {
    variants: {
      size: {
        default: "py-0.5 [&_svg]:size-3",
        xs: "py-0.5 [&_svg]:size-3",
        sm: "py-1 [&_svg]:size-4",
        lg: "py-1.5 [&_svg]:size-4",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function Select({
  size = "default",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root> & {
  size?: SelectSize
}) {
  return (
    <SelectSizeContext.Provider value={size}>
      <SelectPrimitive.Root data-slot="select" data-size={size} {...props} />
    </SelectSizeContext.Provider>
  )
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> &
  VariantProps<typeof selectTriggerVariants>) {
  const contextSize = React.useContext(SelectSizeContext)
  const resolvedSize = size ?? contextSize

  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={resolvedSize}
      className={cn(
        selectTriggerVariants({ size: resolvedSize }),
        "focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const size = React.useContext(SelectSizeContext)

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-size={size}
        className={cn(
          selectContentVariants({ size }),
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            selectViewportVariants({ size }),
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  const size = React.useContext(SelectSizeContext)

  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      data-size={size}
      className={cn(selectLabelVariants({ size }), className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  const size = React.useContext(SelectSizeContext)

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      data-size={size}
      className={cn(selectItemVariants({ size }), className)}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className={cn(
          "absolute right-2 flex items-center justify-center",
          size === "xs" || size === "default" ? "size-3" : "size-4"
        )}
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className={size === "xs" || size === "default" ? "size-3" : "size-4"} />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  const size = React.useContext(SelectSizeContext)

  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      data-size={size}
      className={cn(selectScrollButtonVariants({ size }), className)}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  const size = React.useContext(SelectSizeContext)

  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      data-size={size}
      className={cn(selectScrollButtonVariants({ size }), className)}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  selectTriggerVariants,
}
