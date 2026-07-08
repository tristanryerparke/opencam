import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { PanelLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

type SidebarContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
  toggleSidebar: () => void
}

type SidebarSize = "default" | "xs" | "sm" | "lg"

const SidebarContext = React.createContext<SidebarContextValue | null>(null)
const SidebarSizeContext = React.createContext<SidebarSize>("xs")

type SidebarProviderProps = React.PropsWithChildren<{
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  size?: SidebarSize
}>

function SidebarProvider({
  children,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  size = "xs",
}: SidebarProviderProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)

  const open = openProp ?? internalOpen

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (openProp === undefined) {
        setInternalOpen(nextOpen)
      }

      onOpenChange?.(nextOpen)
    },
    [onOpenChange, openProp]
  )

  const toggleSidebar = React.useCallback(() => {
    setOpen(!open)
  }, [open, setOpen])

  const value = React.useMemo(
    () => ({ open, setOpen, toggleSidebar }),
    [open, setOpen, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={value}>
      <SidebarSizeContext.Provider value={size}>
        {children}
      </SidebarSizeContext.Provider>
    </SidebarContext.Provider>
  )
}

function useSidebar() {
  const context = React.useContext(SidebarContext)

  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

const sidebarSectionVariants = cva("", {
  variants: {
    size: {
      default: "p-2",
      xs: "p-2",
      sm: "p-2",
      lg: "p-3",
    },
  },
  defaultVariants: {
    size: "xs",
  },
})

const sidebarContentVariants = cva(
  "flex min-h-0 flex-1 flex-col overflow-y-auto",
  {
    variants: {
      size: {
        default: "gap-4 p-2",
        xs: "gap-3 p-2",
        sm: "gap-3 p-2",
        lg: "gap-4 p-3",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

const sidebarGroupVariants = cva("flex flex-col", {
  variants: {
    size: {
      default: "gap-3",
      xs: "gap-2",
      sm: "gap-2.5",
      lg: "gap-3",
    },
  },
  defaultVariants: {
    size: "xs",
  },
})

const sidebarGroupLabelVariants = cva(
  "text-muted-foreground font-medium uppercase",
  {
    variants: {
      size: {
        default: "px-2 text-sm tracking-[0.14em]",
        xs: "px-2 text-xs tracking-[0.16em]",
        sm: "px-2 text-sm tracking-[0.14em]",
        lg: "px-3 text-base tracking-[0.12em]",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

const sidebarMenuVariants = cva("flex list-none flex-col", {
  variants: {
    size: {
      default: "gap-1",
      xs: "gap-0.5",
      sm: "gap-1",
      lg: "gap-1.5",
    },
  },
  defaultVariants: {
    size: "xs",
  },
})

const sidebarMenuButtonVariants = cva(
  "relative inline-flex w-full items-center gap-1.5 rounded-md border border-transparent font-medium whitespace-nowrap text-left text-foreground/60 transition-all outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring data-[active=true]:bg-foreground/15 data-[active=true]:text-foreground dark:text-muted-foreground dark:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      size: {
        default: "px-2 py-1 text-sm",
        xs: "px-2 py-1 text-xs",
        sm: "px-3 py-1 text-sm",
        lg: "px-4 py-2 text-base",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function Sidebar({ className, children, style, ...props }: React.ComponentProps<"aside">) {
  const { open } = useSidebar()
  const size = React.useContext(SidebarSizeContext)

  return (
    <div
      data-slot="sidebar-wrapper"
      data-state={open ? "open" : "closed"}
      data-size={size}
      style={style}
      className={cn(
        "group/sidebar relative shrink-0 overflow-hidden border-r border-border bg-background text-foreground transition-[width,border-color] duration-200 ease-out",
        open ? "w-[var(--sidebar-width,18rem)]" : "w-0 border-r-0"
      )}
    >
      <aside
        data-slot="sidebar"
        data-size={size}
        className={cn(
          "flex h-full w-[var(--sidebar-width,18rem)] flex-col",
          className
        )}
        {...props}
      >
        {children}
      </aside>
    </div>
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  const size = React.useContext(SidebarSizeContext)

  return (
    <div
      data-slot="sidebar-header"
      data-size={size}
      className={cn(
        "shrink-0 border-b border-border",
        sidebarSectionVariants({ size }),
        className
      )}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  const size = React.useContext(SidebarSizeContext)

  return (
    <div
      data-slot="sidebar-content"
      data-size={size}
      className={cn(sidebarContentVariants({ size }), className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  const size = React.useContext(SidebarSizeContext)

  return (
    <div
      data-slot="sidebar-footer"
      data-size={size}
      className={cn(
        "shrink-0 border-t border-border",
        sidebarSectionVariants({ size }),
        className
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-inset"
      className={cn(
        "flex h-svh min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"section">) {
  const size = React.useContext(SidebarSizeContext)

  return (
    <section
      data-slot="sidebar-group"
      data-size={size}
      className={cn(sidebarGroupVariants({ size }), className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  const size = React.useContext(SidebarSizeContext)

  return (
    <div
      data-slot="sidebar-group-label"
      data-size={size}
      className={cn(sidebarGroupLabelVariants({ size }), className)}
      {...props}
    />
  )
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  const size = React.useContext(SidebarSizeContext)

  return (
    <ul
      data-slot="sidebar-menu"
      data-size={size}
      className={cn(sidebarMenuVariants({ size }), className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn("list-none", className)}
      {...props}
    />
  )
}

function SidebarMenuButton({
  className,
  isActive = false,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof sidebarMenuButtonVariants> & {
    isActive?: boolean
    asChild?: boolean
  }) {
  const contextSize = React.useContext(SidebarSizeContext)
  const resolvedSize = size ?? contextSize
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-size={resolvedSize}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ size: resolvedSize }), className)}
      {...props}
    />
  )
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      className={cn("bg-border", className)}
      {...props}
    />
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "variant">) {
  const { open, toggleSidebar } = useSidebar()

  return (
    <Button
      type="button"
      size="icon-xs"
      variant="outline"
      className={className}
      aria-label={open ? "Hide sidebar" : "Show sidebar"}
      onClick={(event) => {
        onClick?.(event)

        if (!event.defaultPrevented) {
          toggleSidebar()
        }
      }}
      {...props}
    >
      <PanelLeft className="size-3.5" />
      <span className="sr-only">Toggle sidebar</span>
    </Button>
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
}
