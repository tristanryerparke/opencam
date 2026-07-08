import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type TabsSize = "default" | "xs" | "sm" | "lg"

const TabsSizeContext = React.createContext<TabsSize>("xs")

function Tabs({
  className,
  orientation = "horizontal",
  size = "xs",
  disabled = false,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & {
  size?: TabsSize
  disabled?: boolean
}) {
  return (
    <TabsSizeContext.Provider value={size}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-orientation={orientation}
        data-size={size}
        data-disabled={disabled}
        orientation={orientation}
        className={cn(
          "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
          className
        )}
        {...props}
      />
    </TabsSizeContext.Provider>
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg text-muted-foreground group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col group-data-[disabled=true]/tabs:opacity-30 data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "border border-border",
        line: "gap-1 bg-transparent",
      },
      size: {
        default: "group-data-[orientation=horizontal]/tabs:h-9 p-[3px]",
        xs: "group-data-[orientation=horizontal]/tabs:h-6 p-0.5",
        sm: "group-data-[orientation=horizontal]/tabs:h-8 p-[3px]",
        lg: "group-data-[orientation=horizontal]/tabs:h-10 p-1",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "xs",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  size,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const contextSize = React.useContext(TabsSizeContext)
  const resolvedSize = size ?? contextSize

  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      data-size={resolvedSize}
      className={cn(tabsListVariants({ variant, size: resolvedSize }), className)}
      {...props}
    />
  )
}

const tabsTriggerVariants = cva(
  "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent font-medium whitespace-nowrap text-foreground/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-30 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      size: {
        default: "px-2 py-1 text-sm",
        xs: "px-2 py-1 text-xs",
        sm: "px-2 py-1 text-sm",
        lg: "px-2 py-2 text-base",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function TabsTrigger({
  className,
  size,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> &
  VariantProps<typeof tabsTriggerVariants>) {
  const contextSize = React.useContext(TabsSizeContext)
  const resolvedSize = size ?? contextSize

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-size={resolvedSize}
      className={cn(
        tabsTriggerVariants({ size: resolvedSize }),
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent",
        "data-[state=active]:bg-foreground/15 data-[state=active]:text-foreground dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
