import { VisibilityPicker } from "opencam-react-ui/visibility-picker";

import { useCamStore } from "@/state/cam-store";

export function VisibilityBar() {
  const showStock = useCamStore((state) => state.viewport.showStock);
  const showPartMesh = useCamStore((state) => state.viewport.showPartMesh);
  const showToolpaths = useCamStore((state) => state.viewport.showToolpaths);
  const showTool = useCamStore((state) => state.viewport.showTool);
  const isSimulationMode = useCamStore((state) => state.viewport.isSimulationMode);
  const setShowStock = useCamStore((state) => state.actions.setShowStock);
  const setShowPartMesh = useCamStore((state) => state.actions.setShowPartMesh);
  const setShowToolpaths = useCamStore((state) => state.actions.setShowToolpaths);
  const setShowTool = useCamStore((state) => state.actions.setShowTool);

  return <VisibilityPicker
    className="pointer-events-auto shadow backdrop-blur"
    value={{ stock: showStock, part: showPartMesh, toolpath: showToolpaths, tool: showTool }}
    toolEnabled={isSimulationMode}
    onChange={(key, visible) => {
      if (key === "stock") setShowStock(visible);
      else if (key === "part") setShowPartMesh(visible);
      else if (key === "toolpath") setShowToolpaths(visible);
      else setShowTool(visible);
    }}
  />;
}
