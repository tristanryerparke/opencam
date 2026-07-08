import { getBackendUrl } from "@/hooks/useBackendConnection";

export type ToolNumber = number | "manual";

export type ToolLibraryTool = {
  id: string;
  name: string;
  diameter: number;
  fluteLength: number;
  shoulderLength: number;
  toolNumber: ToolNumber;
};

export type ToolLibraryToolInput = Omit<ToolLibraryTool, "id"> & {
  id?: string;
};

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (response.ok) {
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { detail?: string };
    throw new Error(payload.detail ?? fallbackMessage);
  }

  const detail = await response.text();
  throw new Error(detail || fallbackMessage);
}

export async function listTools(): Promise<ToolLibraryTool[]> {
  const response = await fetch(`${getBackendUrl()}/cam/tools`);
  return readJsonResponse<ToolLibraryTool[]>(response, "Failed to load tools.");
}

export async function addTool(tool: ToolLibraryToolInput): Promise<ToolLibraryTool> {
  const response = await fetch(`${getBackendUrl()}/cam/tools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tool),
  });
  return readJsonResponse<ToolLibraryTool>(response, "Failed to add tool.");
}

export async function updateTool(tool: ToolLibraryTool): Promise<ToolLibraryTool> {
  const response = await fetch(`${getBackendUrl()}/cam/tools/${encodeURIComponent(tool.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tool),
  });
  return readJsonResponse<ToolLibraryTool>(response, "Failed to update tool.");
}

export async function deleteTool(toolId: string): Promise<void> {
  const response = await fetch(`${getBackendUrl()}/cam/tools/${encodeURIComponent(toolId)}`, {
    method: "DELETE",
  });
  await readJsonResponse<void>(response, "Failed to delete tool.");
}
