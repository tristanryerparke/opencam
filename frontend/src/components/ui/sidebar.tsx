import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { PanelLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

type SidebarProviderProps = React.PropsWithChildren<{
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}>;

function SidebarProvider({
  children,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
}: SidebarProviderProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);

  const open = openProp ?? internalOpen;

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (openProp === undefined) {
        setInternalOpen(nextOpen);
      }

      onOpenChange?.(nextOpen);
    },
    [onOpenChange, openProp],
  );

  const toggleSidebar = React.useCallback(() => {
    setOpen(!open);
  }, [open, setOpen]);

  const value = React.useMemo(
    () => ({ open, setOpen, toggleSidebar }),
    [open, setOpen, toggleSidebar],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

function useSidebar() {
  const context = React.useContext(SidebarContext);

  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

function Sidebar({ className, children, style, ...props }: React.ComponentProps<"aside">) {
  const { open } = useSidebar();

  return (
    <div
      data-slot="sidebar-wrapper"
      data-state={open ? "open" : "closed"}
      style={style}
      className={cn(
        "relative shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,border-color] duration-200 ease-out",
        open ? "w-[var(--sidebar-width,18rem)]" : "w-0 border-r-0",
      )}
    >
      <aside
        data-slot="sidebar"
        className={cn("flex h-full w-[var(--sidebar-width,18rem)] flex-col", className)}
        {...props}
      >
        {children}
      </aside>
    </div>
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("shrink-0 flex flex-col gap-4 border-b border-sidebar-border p-2", className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn("flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-2", className)}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn("shrink-0 border-t border-sidebar-border p-2", className)}
      {...props}
    />
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-inset"
      className={cn("flex h-svh min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background", className)}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="sidebar-group"
      className={cn("flex flex-col gap-3", className)}
      {...props}
    />
  );
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        "px-1 text-xs font-medium tracking-[0.16em] text-sidebar-foreground/60 uppercase",
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("flex list-none flex-col gap-1", className)}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn("list-none", className)}
      {...props}
    />
  );
}

function SidebarMenuButton({
  className,
  isActive = false,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & {
  isActive?: boolean;
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-1.5 py-1 text-left text-sm transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      className={cn("bg-sidebar-border", className)}
      {...props}
    />
  );
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "variant">) {
  const { open, toggleSidebar } = useSidebar();

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="outline"
      className={className}
      aria-label={open ? "Hide sidebar" : "Show sidebar"}
      onClick={(event) => {
        onClick?.(event);

        if (!event.defaultPrevented) {
          toggleSidebar();
        }
      }}
      {...props}
    >
      <PanelLeft className="size-3.5" />
      <span className="sr-only">Toggle sidebar</span>
    </Button>
  );
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
};
