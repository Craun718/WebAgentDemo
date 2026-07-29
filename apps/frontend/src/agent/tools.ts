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
    height: Type.Optional(
      Type.Number({ description: "View height above ground in meters (default 20000)" }),
    ),
    heading: Type.Optional(
      Type.Number({ description: "Heading in degrees clockwise from north (default 0)" }),
    ),
    pitch: Type.Optional(
      Type.Number({ description: "Pitch in degrees below horizon (default -90, straight down)" }),
    ),
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
        destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
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

/** Default fill/outline color (CSS color string) for shapes drawn by the agent. */
const DEFAULT_DRAW_COLOR = "#ff9500";

/**
 * A lazily-created CustomDataSource holding every shape drawn by the agent
 * tools, so shapes persist on the globe and can be cleared or removed by id.
 */
let drawingsSource: Cesium.CustomDataSource | null = null;

/** Human-readable metadata for a drawn shape, kept in sync with the entities. */
interface DrawingMeta {
  type: "circle" | "rectangle";
  summary: string;
}

/** id -> metadata for every shape currently on the globe. */
const drawingMeta = new Map<string, DrawingMeta>();

/** Monotonic counter producing unique, readable shape ids (never reused). */
let drawingCounter = 0;

/**
 * Get the shared drawings data source, creating and registering it on first
 * use. Recreated if the viewer no longer contains it (e.g. after a remount);
 * the metadata map is cleared on recreate since the old shapes no longer exist.
 */
function ensureDrawingsSource(viewer: Cesium.Viewer): Cesium.CustomDataSource {
  if (drawingsSource && viewer.dataSources.contains(drawingsSource)) {
    return drawingsSource;
  }
  drawingsSource = new Cesium.CustomDataSource("agent-drawings");
  viewer.dataSources.add(drawingsSource);
  drawingMeta.clear();
  return drawingsSource;
}

/** Resolve a color string, falling back to the default when empty/missing. */
function resolveColor(color: unknown): string {
  return typeof color === "string" && color.trim() !== "" ? color : DEFAULT_DRAW_COLOR;
}

/** Draw a filled circle (geodesic) on the Cesium globe. */
const drawCircle: AgentTool = {
  name: "draw_circle",
  description:
    "Draw a filled circle on the Cesium 3D globe. " +
    "Provide the center longitude and latitude in decimal degrees and the radius in meters. " +
    "Optionally specify a fill/outline color as a CSS color string (e.g. '#ff9500', 'red'). " +
    "Shapes persist on the globe and each is assigned an id (returned in the result) " +
    "that can be used with list_drawings and remove_drawing.",
  parameters: Type.Object({
    longitude: Type.Number({ description: "Center longitude in decimal degrees" }),
    latitude: Type.Number({ description: "Center latitude in decimal degrees" }),
    radius: Type.Number({ description: "Circle radius in meters" }),
    color: Type.Optional(
      Type.String({ description: "CSS color (e.g. '#ff9500', 'red'); defaults to orange" }),
    ),
  }),
  execute: (args: Record<string, unknown>) => {
    const longitude = Number(args.longitude);
    const latitude = Number(args.latitude);
    const radius = Number(args.radius);
    const colorStr = resolveColor(args.color);

    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return `Invalid longitude: ${JSON.stringify(args.longitude)}. Provide a value in [-180, 180].`;
    }
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return `Invalid latitude: ${JSON.stringify(args.latitude)}. Provide a value in [-90, 90].`;
    }
    if (!Number.isFinite(radius) || radius <= 0) {
      return `Invalid radius: ${JSON.stringify(args.radius)}. Provide a positive number of meters.`;
    }

    const viewer = getViewer();
    if (!viewer) {
      return "Cesium globe is not initialized yet. Please wait for the page to load.";
    }
    try {
      const color = Cesium.Color.fromCssColorString(colorStr);
      const id = `circle-${++drawingCounter}`;
      ensureDrawingsSource(viewer).entities.add({
        id,
        position: Cesium.Cartesian3.fromDegrees(longitude, latitude),
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          material: color.withAlpha(0.3),
          outline: true,
          outlineColor: color,
          height: 0,
        },
      });
      drawingMeta.set(id, {
        type: "circle",
        summary: `circle at ${latitude}°, ${longitude}° radius ${radius}m`,
      });
      return `Drew circle at ${latitude}°, ${longitude}° radius ${radius}m (id: ${id}).`;
    } catch (err) {
      return `draw_circle failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/** Draw a filled rectangle (geodetic bounding box) on the Cesium globe. */
const drawRectangle: AgentTool = {
  name: "draw_rectangle",
  description:
    "Draw a filled rectangle on the Cesium 3D globe from a geodetic bounding box. " +
    "Provide the west, south, east, and north edges in decimal degrees " +
    "(edges may be given in any order; they are normalized). " +
    "Optionally specify a fill/outline color as a CSS color string (e.g. '#ff9500', 'red'). " +
    "Shapes persist on the globe and each is assigned an id (returned in the result) " +
    "that can be used with list_drawings and remove_drawing.",
  parameters: Type.Object({
    west: Type.Number({ description: "Western longitude in decimal degrees" }),
    south: Type.Number({ description: "Southern latitude in decimal degrees" }),
    east: Type.Number({ description: "Eastern longitude in decimal degrees" }),
    north: Type.Number({ description: "Northern latitude in decimal degrees" }),
    color: Type.Optional(
      Type.String({ description: "CSS color (e.g. '#ff9500', 'red'); defaults to orange" }),
    ),
  }),
  execute: (args: Record<string, unknown>) => {
    let west = Number(args.west);
    let south = Number(args.south);
    let east = Number(args.east);
    let north = Number(args.north);
    const colorStr = resolveColor(args.color);

    if (![west, south, east, north].every(Number.isFinite)) {
      return `Invalid bounds: ${JSON.stringify({ west: args.west, south: args.south, east: args.east, north: args.north })}. All must be finite numbers.`;
    }
    if (west < -180 || west > 180 || east < -180 || east > 180) {
      return `Invalid longitude bounds (west=${west}, east=${east}). Provide values in [-180, 180].`;
    }
    if (south < -90 || south > 90 || north < -90 || north > 90) {
      return `Invalid latitude bounds (south=${south}, north=${north}). Provide values in [-90, 90].`;
    }

    // Normalize so the rectangle is well-formed regardless of input order.
    if (east < west) [west, east] = [east, west];
    if (north < south) [south, north] = [north, south];

    const viewer = getViewer();
    if (!viewer) {
      return "Cesium globe is not initialized yet. Please wait for the page to load.";
    }
    try {
      const color = Cesium.Color.fromCssColorString(colorStr);
      const id = `rectangle-${++drawingCounter}`;
      ensureDrawingsSource(viewer).entities.add({
        id,
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(west, south, east, north),
          material: color.withAlpha(0.3),
          outline: true,
          outlineColor: color,
          height: 0,
        },
      });
      drawingMeta.set(id, {
        type: "rectangle",
        summary: `rectangle ${west},${south} -> ${east},${north}`,
      });
      return `Drew rectangle ${west},${south} -> ${east},${north} (id: ${id}).`;
    } catch (err) {
      return `draw_rectangle failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/** List every circle and rectangle currently drawn on the Cesium globe. */
const listDrawings: AgentTool = {
  name: "list_drawings",
  description:
    "List all circles and rectangles currently drawn on the Cesium globe, " +
    "each with its id, type, and geometry. Use the returned id with remove_drawing " +
    "to delete a single shape, or clear_drawings to remove all of them. " +
    "Takes no parameters.",
  parameters: Type.Object({}),
  execute: () => {
    const viewer = getViewer();
    if (
      !drawingsSource ||
      !viewer ||
      !viewer.dataSources.contains(drawingsSource) ||
      drawingMeta.size === 0
    ) {
      return "No shapes on the globe.";
    }
    const lines = [`${drawingMeta.size} shape(s) on the globe:`];
    for (const [id, meta] of drawingMeta) {
      lines.push(`- ${id}: ${meta.summary}`);
    }
    return lines.join("\n");
  },
};

/** Remove a single drawn shape (circle or rectangle) by its id. */
const removeDrawing: AgentTool = {
  name: "remove_drawing",
  description:
    "Remove a single shape (circle or rectangle) from the Cesium globe by its id. " +
    "Use list_drawings to find the id of the shape to remove. " +
    "To remove all shapes at once, use clear_drawings instead.",
  parameters: Type.Object({
    id: Type.String({ description: "The id of the shape to remove (from list_drawings)" }),
  }),
  execute: (args: Record<string, unknown>) => {
    const id = typeof args.id === "string" ? args.id : String(args.id);
    const viewer = getViewer();
    if (!drawingsSource || !viewer || !viewer.dataSources.contains(drawingsSource)) {
      return `No shapes on the globe; cannot remove "${id}".`;
    }
    if (!drawingMeta.has(id)) {
      return `No shape with id "${id}". Call list_drawings to see current shape ids.`;
    }
    try {
      drawingsSource.entities.removeById(id);
      drawingMeta.delete(id);
      return `Removed shape ${id}.`;
    } catch (err) {
      return `remove_drawing failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/** Remove every circle and rectangle drawn by the draw_* tools. */
const clearDrawings: AgentTool = {
  name: "clear_drawings",
  description:
    "Remove every circle and rectangle previously drawn on the Cesium globe " +
    "by the draw_circle and draw_rectangle tools. Takes no parameters.",
  parameters: Type.Object({}),
  execute: () => {
    const viewer = getViewer();
    if (!drawingsSource || !viewer || !viewer.dataSources.contains(drawingsSource)) {
      return "No shapes to clear.";
    }
    try {
      drawingsSource.entities.removeAll();
      drawingMeta.clear();
      return "Cleared all drawn shapes.";
    } catch (err) {
      return `clear_drawings failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/** Registry of client-side tools available to the agent. */
export const tools: AgentTool[] = [
  getCurrentTime,
  flyTo,
  getCameraInfo,
  drawCircle,
  drawRectangle,
  listDrawings,
  removeDrawing,
  clearDrawings,
];
