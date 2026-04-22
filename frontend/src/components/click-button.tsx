import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getBackendUrl } from "@/hooks/useBackendConnection";
import { cn } from "@/lib/utils";

export function ClickButton({ className }: { className?: string }) {
  const [status, setStatus] = useState<"idle" | "connecting" | "success" | "failed">("idle");

  async function handleClick() {
    if (status !== "idle") return;
    setStatus("connecting");
    try {
      const res = await fetch(`${getBackendUrl()}/ping`);
      await res.json();
      setStatus("success");
    } catch {
      setStatus("failed");
    }
    setTimeout(() => setStatus("idle"), 5000);
  }

  const buttonText = {
    idle: "Test Connection",
    connecting: "Connecting...",
    success: "Connection Success",
    failed: "Connection Failed",
  }[status];

  const buttonClass = {
    idle: "w-full",
    connecting: "w-full",
    success: "w-full !border-green-600 !text-green-600",
    failed: "w-full !border-red-600 !text-red-600",
  }[status];

  return (
    <Button
      variant="outline"
      className={cn(buttonClass, className)}
      onClick={handleClick}
      disabled={status === "connecting"}
    >
      {buttonText}
    </Button>
  );
}
