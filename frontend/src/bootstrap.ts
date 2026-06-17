export type OpenCamBootstrap = {
  mode?: string;
  backendUrl?: string;
};

export type OpenCamRhinoDebugLevel = "info" | "error";
export type OpenCamRhinoDebugFn = (
  level: OpenCamRhinoDebugLevel,
  message: string,
  data?: unknown,
) => void;

declare global {
  interface Window {
    __OPENCAM_BOOTSTRAP__?: OpenCamBootstrap;
    __openCamRhinoDebug?: OpenCamRhinoDebugFn;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getOpenCamBootstrap(): OpenCamBootstrap {
  if (typeof window === "undefined") {
    return {};
  }

  const bootstrap = window.__OPENCAM_BOOTSTRAP__;
  if (!isObject(bootstrap)) {
    return {};
  }

  return {
    mode: readString(bootstrap.mode) ?? undefined,
    backendUrl: readString(bootstrap.backendUrl) ?? undefined,
  };
}

export function sendRhinoUiDebug(
  level: OpenCamRhinoDebugLevel,
  message: string,
  data?: unknown,
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.__openCamRhinoDebug?.(level, message, data);
  } catch (error) {
    const logger = level === "error" ? console.error : console.info;
    logger("[OpenCAM:UI debug bridge failed]", error);
  }
}
