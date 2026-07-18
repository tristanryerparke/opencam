import { useRef } from "react";

import { cn } from "@/lib/utils";

import type { PolylineViewerProps } from "./types";
import { usePolylineViewerScene } from "./use-polyline-viewer-scene";

export function PolylineViewer(props: PolylineViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { className, meshUrl, ...sceneProps } = props;

  usePolylineViewerScene(containerRef, { meshUrl, ...sceneProps });

  return (
    <div
      className={cn(
        "relative h-full min-h-0 overflow-hidden rounded-2xl border bg-gradient-to-br from-muted/30 via-background to-muted/50 shadow-sm",
        className,
      )}
    >
      <div ref={containerRef} className="h-full w-full" />

      {!meshUrl ? (
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-xl border bg-background/85 p-2 shadow-sm backdrop-blur">
          <p className="text-xs text-muted-foreground">Upload a STEP file to begin.</p>
        </div>
      ) : null}
    </div>
  );
}
