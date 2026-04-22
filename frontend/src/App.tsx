import { useCallback, useMemo, useState } from "react";
import { Eye, EyeOff, Layers3, Route, Waypoints, Workflow } from "lucide-react";

import { ClickButton } from "@/components/click-button";
import { ModeToggle } from "@/components/mode-toggle";
import {
  PolylineViewer,
  type MeshFaceSelection,
  type PolylineDefinition,
  type PolylinePoint,
} from "@/components/polyline-viewer";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

function buildOuterContour(): PolylinePoint[] {
  return [
    [-84, -58, 0],
    [84, -58, 0],
    [84, 58, 0],
    [-84, 58, 0],
    [-84, -58, 0],
  ];
}

function buildPocketSpiral(): PolylinePoint[] {
  const points: PolylinePoint[] = [];
  let minX = -58;
  let maxX = 58;
  let minY = -34;
  let maxY = 34;
  let z = 14;

  points.push([minX, minY, z]);

  while (maxX - minX > 18 && maxY - minY > 18) {
    points.push([maxX, minY, z]);
    points.push([maxX, maxY, z]);
    points.push([minX + 12, maxY, z - 1.8]);
    points.push([minX + 12, minY + 12, z - 3.6]);

    minX += 12;
    maxX -= 12;
    minY += 12;
    maxY -= 12;
    z -= 3.6;
  }

  points.push([0, 0, 0]);

  return points;
}

function buildScanPass(): PolylinePoint[] {
  const points: PolylinePoint[] = [];

  for (let row = 0; row < 7; row += 1) {
    const y = -48 + row * 16;
    const z = 18 - row * 1.4;

    if (row % 2 === 0) {
      points.push([-78, y, z], [78, y, z]);
    } else {
      points.push([78, y, z], [-78, y, z]);
    }
  }

  return points;
}

function buildLeadInHelix(): PolylinePoint[] {
  const points: PolylinePoint[] = [];
  const segments = 52;

  for (let index = 0; index < segments; index += 1) {
    const t = index / (segments - 1);
    const angle = t * Math.PI * 4;

    points.push([
      52 + Math.cos(angle) * 14,
      -24 + Math.sin(angle) * 14,
      28 - t * 26,
    ]);
  }

  return points;
}

function getPolylineLength(points: ReadonlyArray<PolylinePoint>) {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay, az] = points[index - 1];
    const [bx, by, bz] = points[index];
    total += Math.hypot(bx - ax, by - ay, bz - az);
  }

  return total;
}

const samplePolylines: PolylineDefinition[] = [
  {
    id: "outer-contour",
    name: "Outer contour",
    color: "#60a5fa",
    points: buildOuterContour(),
  },
  {
    id: "pocket-spiral",
    name: "Pocket spiral",
    color: "#f97316",
    points: buildPocketSpiral(),
  },
  {
    id: "scan-pass",
    name: "Scan pass",
    color: "#22c55e",
    points: buildScanPass(),
  },
  {
    id: "lead-in-helix",
    name: "Lead-in helix",
    color: "#e879f9",
    points: buildLeadInHelix(),
  },
];

const toolpathIcons = [Route, Layers3, Workflow, Waypoints] as const;
const toolpathNotes = [
  "Closed profile loop",
  "Descending pocketing pass",
  "Serpentine finishing path",
  "Helical lead-in move",
] as const;

const toolpathCards = samplePolylines.map((polyline, index) => ({
  polyline,
  icon: toolpathIcons[index % toolpathIcons.length],
  note: toolpathNotes[index % toolpathNotes.length],
  length: getPolylineLength(polyline.points),
}));

function App() {
  const [visiblePolylineIds, setVisiblePolylineIds] = useState<Set<string>>(
    () => new Set(samplePolylines.map((polyline) => polyline.id)),
  );
  const [faceSelectionMode, setFaceSelectionMode] = useState(false);
  const [selectedMeshFace, setSelectedMeshFace] = useState<MeshFaceSelection | null>(null);

  const visibleToolpathCards = useMemo(
    () =>
      toolpathCards.filter(({ polyline }) => visiblePolylineIds.has(polyline.id)),
    [visiblePolylineIds],
  );

  const visiblePolylines = useMemo(
    () => visibleToolpathCards.map(({ polyline }) => polyline),
    [visibleToolpathCards],
  );

  const handleMeshFaceSelect = useCallback((selection: MeshFaceSelection) => {
    setSelectedMeshFace(selection);
    setFaceSelectionMode(false);
  }, []);

  function togglePolylineVisibility(polylineId: string) {
    setVisiblePolylineIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(polylineId)) {
        nextIds.delete(polylineId);
      } else {
        nextIds.add(polylineId);
      }

      return nextIds;
    });
  }

  return (
    <SidebarProvider defaultOpen>
      <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground">
        <header className="shrink-0 flex items-center justify-between gap-3 border-b px-2 py-1.5 md:px-3">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <h2 className="text-sm font-semibold md:text-base">OpenCAM Viewer</h2>
          </div>

          <ModeToggle />
        </header>

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <Sidebar>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>Toolpaths</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {toolpathCards.map(({ polyline, icon: Icon, note, length }) => {
                      const isVisible = visiblePolylineIds.has(polyline.id);

                      return (
                        <SidebarMenuItem key={polyline.id}>
                          <SidebarMenuButton
                            type="button"
                            isActive={isVisible}
                            aria-pressed={isVisible}
                            onClick={() => togglePolylineVisibility(polyline.id)}
                            className={!isVisible ? "opacity-55" : undefined}
                          >
                            <span
                              className="size-2.5 rounded-full"
                              style={{ backgroundColor: polyline.color }}
                            />
                            <Icon className="size-4 shrink-0 text-sidebar-foreground/70" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{polyline.name}</div>
                              <div className="truncate text-xs text-sidebar-foreground/60">
                                {isVisible ? note : "Hidden · click to show"}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className="rounded-md bg-sidebar-foreground/10 px-1 py-0.5 text-[11px] text-sidebar-foreground/80">
                                {length.toFixed(0)} mm
                              </div>
                              {isVisible ? (
                                <Eye className="size-3.5 text-sidebar-foreground/75" />
                              ) : (
                                <EyeOff className="size-3.5 text-sidebar-foreground/55" />
                              )}
                            </div>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>

              <SidebarGroup>
                <SidebarGroupLabel>Mesh face</SidebarGroupLabel>
                <SidebarGroupContent>
                  <Button
                    type="button"
                    variant={faceSelectionMode ? "default" : "outline"}
                    className="w-full justify-start"
                    onClick={() => setFaceSelectionMode((current) => !current)}
                  >
                    {faceSelectionMode ? "Click mesh face in viewport" : "Pick flat face"}
                  </Button>

                  {selectedMeshFace ? (
                    <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-1.5">
                      <div className="text-sm font-medium">{selectedMeshFace.label}</div>
                      <p className="mt-1 text-xs leading-5 text-sidebar-foreground/65">
                        {selectedMeshFace.area.toFixed(0)} mm² · {selectedMeshFace.triangleCount} triangles
                      </p>
                    </div>
                  ) : null}

                  <p className="px-1 text-xs leading-5 text-sidebar-foreground/65">
                    {faceSelectionMode
                      ? "Left-click a mesh face to select the full connected flat side."
                      : selectedMeshFace
                        ? "Selected mesh face is outlined in the viewport."
                        : "No flat face selected."}
                  </p>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>

            <SidebarFooter>
              <div className="space-y-3 rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-1.5">
                <div>
                  <div className="text-sm font-medium">Backend quick check</div>
                  <p className="mt-1 text-xs leading-5 text-sidebar-foreground/65">
                    Ping the API from the web client while keeping the viewer in the
                    main window.
                  </p>
                </div>
                <ClickButton />
              </div>
            </SidebarFooter>
          </Sidebar>

          <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <PolylineViewer
              polylines={visiblePolylines}
              faceSelectionMode={faceSelectionMode}
              selectedMeshFace={selectedMeshFace}
              onMeshFaceSelect={handleMeshFaceSelect}
              className="h-full min-h-0 flex-1 rounded-none border-0 shadow-none"
            />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

export default App;
