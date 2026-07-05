import * as React from "react"

import { cn } from "@/lib/utils"

function GroupBox({
  className,
  title,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  title?: React.ReactNode
}) {
  return (
    <div
      data-slot="group-box"
      className={cn("flex flex-col text-sm", className)}
      {...props}
    >
      {title ? (
        <>
          <GroupBoxTitle>{title}</GroupBoxTitle>
          <GroupBoxContent>{children}</GroupBoxContent>
        </>
      ) : (
        children
      )}
    </div>
  )
}

function GroupBoxTitle({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div data-slot="group-box-title-row" className="flex items-center">
      <div
        aria-hidden="true"
        className="h-3 w-3 shrink-0 rounded-tl-md border-l border-t"
      />
      <div
        data-slot="group-box-title"
        className={cn(
          "shrink-0 px-1 text-xs leading-none font-medium text-muted-foreground -translate-y-1.25",
          className
        )}
        {...props}
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        className="h-3 min-w-3 flex-1 rounded-tr-md border-r border-t"
      />
    </div>
  )
}

function GroupBoxContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="group-box-content"
      className={cn(
        "flex flex-col gap-3 rounded-b-md border-x border-b px-2 pb-2",
        className
      )}
      {...props}
    />
  )
}

export { GroupBox, GroupBoxTitle, GroupBoxContent }
