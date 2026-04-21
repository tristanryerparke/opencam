import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getBackendUrl } from "@/hooks/useBackendConnection";

export function ClickButton() {
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
    idle: "w-60",
    connecting: "w-60",
    success: "w-60 !border-green-600 !text-green-600",
    failed: "w-60 !border-red-600 !text-red-600",
  }[status];

  return <Button variant="outline" className={buttonClass} onClick={handleClick} disabled={status === "connecting"}>{buttonText}</Button>;
}
