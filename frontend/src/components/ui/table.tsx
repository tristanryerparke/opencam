import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const tableVariants = cva("w-full caption-bottom", {
  variants: {
    size: {
      default:
        "text-sm [&_[data-slot=table-head]]:h-9 [&_[data-slot=table-head]]:px-2 [&_[data-slot=table-cell]]:p-2 [&_[data-slot=table-caption]]:mt-4",
      xs:
        "text-xs [&_[data-slot=table-head]]:h-6 [&_[data-slot=table-head]]:px-2 [&_[data-slot=table-cell]]:px-2 [&_[data-slot=table-cell]]:py-1 [&_[data-slot=table-caption]]:mt-2",
      sm:
        "text-sm [&_[data-slot=table-head]]:h-8 [&_[data-slot=table-head]]:px-2 [&_[data-slot=table-cell]]:px-2 [&_[data-slot=table-cell]]:py-1.5 [&_[data-slot=table-caption]]:mt-3",
      lg:
        "text-base [&_[data-slot=table-head]]:h-10 [&_[data-slot=table-head]]:px-2 [&_[data-slot=table-cell]]:px-2 [&_[data-slot=table-cell]]:py-2 [&_[data-slot=table-caption]]:mt-4",
    },
  },
  defaultVariants: {
    size: "xs",
  },
})

function Table({
  className,
  size = "xs",
  ...props
}: React.ComponentProps<"table"> & VariantProps<typeof tableVariants>) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        data-size={size}
        className={cn(tableVariants({ size, className }))}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  tableVariants,
}
