import { getOpenCamBootstrap } from "@/bootstrap";

function normalizeBackendUrl(url: string) {
  return url.replace(/\/$/, "");
}

export const getBackendUrl = (): string => {
  const bootstrap = getOpenCamBootstrap();
  if (bootstrap.backendUrl) {
    return normalizeBackendUrl(bootstrap.backendUrl);
  }

  if (typeof window === "undefined") {
    return "http://127.0.0.1:9090";
  }

  const { location } = window;
  if (location.protocol === "http:" || location.protocol === "https:") {
    return `${location.origin}/api`;
  }

  return "http://127.0.0.1:9090";
};

