// Shared domain types consumed by both backend and frontend via workspace symlink.

export interface HealthResponse {
  status: "ok";
  service: string;
  time: string;
}

export const SERVICE_NAME = "web-agent";

export function buildHealthResponse(service: string): HealthResponse {
  return { status: "ok", service, time: new Date().toISOString() };
}
