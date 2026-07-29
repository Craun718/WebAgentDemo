import type { AgentTool } from "moongazer";
import { Type } from "moongazer";
import { getViewer } from "./cesiumViewer";
import * as Cesium from "cesium";

/** Returns the current time in a given IANA timezone. */
const getCurrentTime: AgentTool = {
  name: "get_current_time",
  description:
    "Get the current date and time in the user's locale. " +
    "Provide `timeZone` as an IANA identifier (e.g. 'Asia/Shanghai', 'America/New_York').",
  // Use a TypeBox schema (not a plain object) so moongazer's Value.Cast can
  // dispatch on the TypeBox.Kind symbol; a bare JSON Schema object throws
  // "Unknown type" inside Value.Check.
  parameters: Type.Object({
    // IANA timezone identifier required.
    timeZone: Type.String(),
  }),
  // An invalid timeZone is reported back to the model instead of silently
  // falling back, so the model can retry with a correct IANA identifier.
  execute: ({ timeZone }) => {
    if (typeof timeZone !== "string" || timeZone.trim() === "") {
      return `Invalid timeZone parameter: ${JSON.stringify(timeZone)}. Provide an IANA timezone identifier such as 'Asia/Shanghai' or 'America/New_York'.`;
    }
    try {
      return new Date().toLocaleString(undefined, { timeZone });
    } catch {
      return `Invalid timeZone parameter: "${timeZone}". Provide a valid IANA timezone identifier such as 'Asia/Shanghai' or 'America/New_York'.`;
    }
  },
};

/** Fly the Cesium globe camera to a given location. */
const flyTo: AgentTool = {
  name: "fly_to",
  description:
    "Fly the Cesium 3D globe camera to a specific geographic location. " +
    "Provide longitude and latitude in decimal degrees. " +
    "Optionally set view height (meters), heading, pitch, and roll (degrees).",
  parameters: Type.Object({
    longitude: Type.Number({ description: "Longitude in decimal degrees" }),
    latitude: Type.Number({ description: "Latitude in decimal degrees" }),
    height: Type.Optional(Type.Number({ description: "View height above ground in meters (default 20000)" })),
    heading: Type.Optional(Type.Number({ description: "Heading in degrees clockwise from north (default 0)" })),
    pitch: Type.Optional(Type.Number({ description: "Pitch in degrees below horizon (default -90, straight down)" })),
  }),
  execute: (args: Record<string, unknown>) => {
    const longitude = Number(args.longitude);
    const latitude = Number(args.latitude);
    const height = args.height != null ? Number(args.height) : 20000;
    const heading = args.heading != null ? Number(args.heading) : 0;
    const pitch = args.pitch != null ? Number(args.pitch) : -90;

    const viewer = getViewer();
    if (!viewer) {
      return "Cesium globe is not initialized yet. Please wait for the page to load.";
    }
    try {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          longitude,
          latitude,
          height,
        ),
        orientation: {
          heading: Cesium.Math.toRadians(heading),
          pitch: Cesium.Math.toRadians(pitch),
          roll: 0,
        },
      });
      return `Flying to ${latitude}°${latitude >= 0 ? "N" : "S"}, ${longitude}°${longitude >= 0 ? "E" : "W"} at ${height}m.`;
    } catch (err) {
      return `flyTo failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/** Get the current Cesium camera position and orientation. */
const getCameraInfo: AgentTool = {
  name: "get_camera_info",
  description:
    "Get the current Cesium globe camera position (longitude, latitude, height) " +
    "and orientation (heading, pitch, roll) in decimal degrees. " +
    "Takes no parameters; useful for understanding what the user is currently looking at.",
  parameters: Type.Object({}),
  execute: () => {
    const viewer = getViewer();
    if (!viewer) {
      return "Cesium globe is not initialized yet. Please wait for the page to load.";
    }
    try {
      const camera = viewer.camera;
      const carto = camera.positionCartographic;
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const hdg = Cesium.Math.toDegrees(camera.heading);
      const pch = Cesium.Math.toDegrees(camera.pitch);
      const rll = Cesium.Math.toDegrees(camera.roll);
      const lines = [
        `Longitude: ${lon.toFixed(6)}°`,
        `Latitude:  ${lat.toFixed(6)}°`,
        `Height:    ${carto.height.toFixed(1)} m`,
        `Heading:   ${hdg.toFixed(2)}°`,
        `Pitch:     ${pch.toFixed(2)}°`,
        `Roll:      ${rll.toFixed(2)}°`,
      ];
      return lines.join("\n");
    } catch (err) {
      return `getCameraInfo failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/** Registry of client-side tools available to the agent. */
export const tools: AgentTool[] = [getCurrentTime, flyTo, getCameraInfo];
