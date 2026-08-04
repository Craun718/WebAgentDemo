import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks so the `cesium` and `./cesiumViewer` module factories can
// reference shared state that the tests then assert against. Cesium is mocked
// to keep the unit tests fast and free of WebGL.
const mocks = vi.hoisted(() => {
  const addedEntities: { id?: string }[] = [];
  const entities = {
    add: vi.fn((entity: { id?: string }) => {
      addedEntities.push(entity);
      return entity;
    }),
    removeById: vi.fn((id: string) => {
      const i = addedEntities.findIndex((e) => e.id === id);
      if (i >= 0) {
        addedEntities.splice(i, 1);
        return true;
      }
      return false;
    }),
    removeAll: vi.fn(() => {
      addedEntities.length = 0;
    }),
  };
  const dataSources = {
    _sources: [] as unknown[],
    add: vi.fn((ds: unknown) => {
      dataSources._sources.push(ds);
      return Promise.resolve(ds);
    }),
    contains: vi.fn((ds: unknown) => dataSources._sources.includes(ds)),
  };
  const viewer = { dataSources };
  const cesium = {
    Cartesian3: { fromDegrees: vi.fn((lon: number, lat: number) => ({ lon, lat })) },
    Rectangle: {
      fromDegrees: vi.fn((w: number, s: number, e: number, n: number) => ({ west: w, south: s, east: e, north: n })),
    },
    Color: {
      fromCssColorString: vi.fn(() => ({
        withAlpha: vi.fn((a: number) => ({ __alpha: a })),
      })),
    },
    CustomDataSource: vi.fn(function (name: string) {
      return { __name: name, entities };
    }),
    Math: { toRadians: (d: number) => (d * Math.PI) / 180, toDegrees: (r: number) => (r * 180) / Math.PI },
  };
  return { addedEntities, entities, dataSources, viewer, cesium, getViewer: vi.fn() };
});

vi.mock("cesium", () => mocks.cesium);
vi.mock("./cesiumViewer", () => ({
  getViewer: mocks.getViewer,
  setViewer: vi.fn(),
}));

import { tools } from "./tools";

const toolByName = (name: string) => tools.find((t) => t.name === name);
const run = (name: string, args: Record<string, unknown> = {}) =>
  toolByName(name)!.execute(args, { signal: new AbortController().signal }) as string;
/** Extract the id from a draw_* result like "... (id: circle-3)." */
const idFrom = (result: string): string => {
  const id = result.match(/id: ([^)]+)\)/)?.[1];
  if (id === undefined) throw new Error(`no id in result: ${result}`);
  return id;
};

beforeEach(() => {
  mocks.addedEntities.length = 0;
  mocks.dataSources._sources.length = 0;
  mocks.entities.add.mockClear();
  mocks.entities.removeById.mockClear();
  mocks.entities.removeAll.mockClear();
  mocks.dataSources.add.mockClear();
  mocks.dataSources.contains.mockClear();
  mocks.cesium.Cartesian3.fromDegrees.mockClear();
  mocks.cesium.Rectangle.fromDegrees.mockClear();
  mocks.cesium.Color.fromCssColorString.mockClear();
  mocks.cesium.CustomDataSource.mockClear();
  mocks.getViewer.mockReset();
  mocks.getViewer.mockReturnValue(mocks.viewer);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("tool registry", () => {
  it("registers all drawing tools", () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "draw_circle",
        "draw_rectangle",
        "list_drawings",
        "remove_drawing",
        "clear_drawings",
      ]),
    );
  });
});

describe("draw_circle", () => {
  it("adds an ellipse entity with equal axes equal to the radius and an id", () => {
    const result = run("draw_circle", { longitude: 116.4, latitude: 39.9, radius: 1000 });

    expect(result).toMatch(/^Drew circle at 39\.9°, 116\.4° radius 1000m \(id: circle-\d+\)\.$/);
    expect(mocks.entities.add).toHaveBeenCalledTimes(1);
    const entity = mocks.addedEntities[0] as {
      id: string;
      position: unknown;
      ellipse: { semiMajorAxis: number; semiMinorAxis: number; outline: boolean };
    };
    expect(entity.id).toMatch(/^circle-\d+$/);
    expect(entity.ellipse.semiMajorAxis).toBe(1000);
    expect(entity.ellipse.semiMinorAxis).toBe(1000);
    expect(entity.ellipse.outline).toBe(true);
    expect(mocks.cesium.Cartesian3.fromDegrees).toHaveBeenCalledWith(116.4, 39.9);
  });

  it("uses the default color when none is provided", () => {
    run("draw_circle", { longitude: 0, latitude: 0, radius: 500 });
    expect(mocks.cesium.Color.fromCssColorString).toHaveBeenCalledWith("#ff9500");
  });

  it("honors a provided color", () => {
    run("draw_circle", { longitude: 0, latitude: 0, radius: 500, color: "#00ff00" });
    expect(mocks.cesium.Color.fromCssColorString).toHaveBeenCalledWith("#00ff00");
  });

  it("returns an error string and adds nothing for non-positive radius", () => {
    const result = run("draw_circle", { longitude: 0, latitude: 0, radius: -5 });
    expect(result).toMatch(/Invalid radius/);
    expect(mocks.entities.add).not.toHaveBeenCalled();
  });

  it("rejects out-of-range longitude/latitude", () => {
    expect(run("draw_circle", { longitude: 200, latitude: 0, radius: 5 })).toMatch(/Invalid longitude/);
    expect(run("draw_circle", { longitude: 0, latitude: 100, radius: 5 })).toMatch(/Invalid latitude/);
    expect(mocks.entities.add).not.toHaveBeenCalled();
  });

  it("returns the not-initialized message when the viewer is absent", () => {
    mocks.getViewer.mockReturnValue(null);
    const result = run("draw_circle", { longitude: 0, latitude: 0, radius: 5 });
    expect(result).toBe("Cesium globe is not initialized yet. Please wait for the page to load.");
    expect(mocks.entities.add).not.toHaveBeenCalled();
  });
});

describe("draw_rectangle", () => {
  it("adds a rectangle entity from the given bounds with an id", () => {
    const result = run("draw_rectangle", { west: 10, south: 20, east: 30, north: 40 });

    expect(result).toMatch(/^Drew rectangle 10,20 -> 30,40 \(id: rectangle-\d+\)\.$/);
    expect(mocks.entities.add).toHaveBeenCalledTimes(1);
    expect(mocks.cesium.Rectangle.fromDegrees).toHaveBeenCalledWith(10, 20, 30, 40);
    const entity = mocks.addedEntities[0] as {
      id: string;
      rectangle: { coordinates: { west: number; south: number; east: number; north: number }; outline: boolean };
    };
    expect(entity.id).toMatch(/^rectangle-\d+$/);
    expect(entity.rectangle.coordinates).toEqual({ west: 10, south: 20, east: 30, north: 40 });
    expect(entity.rectangle.outline).toBe(true);
  });

  it("normalizes bounds given in reverse order", () => {
    const result = run("draw_rectangle", { west: 30, south: 40, east: 10, north: 20 });
    expect(result).toMatch(/^Drew rectangle 10,20 -> 30,40 \(id: rectangle-\d+\)\.$/);
    expect(mocks.cesium.Rectangle.fromDegrees).toHaveBeenCalledWith(10, 20, 30, 40);
  });

  it("returns an error for out-of-range bounds without drawing", () => {
    expect(run("draw_rectangle", { west: -200, south: 0, east: 0, north: 0 })).toMatch(/Invalid longitude bounds/);
    expect(run("draw_rectangle", { west: 0, south: -95, east: 0, north: 0 })).toMatch(/Invalid latitude bounds/);
    expect(mocks.entities.add).not.toHaveBeenCalled();
  });

  it("returns the not-initialized message when the viewer is absent", () => {
    mocks.getViewer.mockReturnValue(null);
    const result = run("draw_rectangle", { west: 0, south: 0, east: 1, north: 1 });
    expect(result).toBe("Cesium globe is not initialized yet. Please wait for the page to load.");
    expect(mocks.entities.add).not.toHaveBeenCalled();
  });
});

describe("list_drawings", () => {
  it("reports no shapes when nothing has been drawn", () => {
    expect(run("list_drawings")).toBe("No shapes on the globe.");
  });

  it("lists every drawn shape with its id, type, and geometry", () => {
    const idC = idFrom(run("draw_circle", { longitude: 116.4, latitude: 39.9, radius: 1000 }));
    const idR = idFrom(run("draw_rectangle", { west: 10, south: 20, east: 30, north: 40 }));

    const list = run("list_drawings");
    expect(list).toContain("2 shape(s) on the globe:");
    expect(list).toContain(`- ${idC}: circle at 39.9°, 116.4° radius 1000m`);
    expect(list).toContain(`- ${idR}: rectangle 10,20 -> 30,40`);
  });
});

describe("remove_drawing", () => {
  it("removes a single shape by id and it disappears from the list", () => {
    const idC = idFrom(run("draw_circle", { longitude: 0, latitude: 0, radius: 100 }));
    const idR = idFrom(run("draw_rectangle", { west: 1, south: 1, east: 2, north: 2 }));

    expect(run("remove_drawing", { id: idC })).toBe(`Removed shape ${idC}.`);
    expect(mocks.entities.removeById).toHaveBeenCalledWith(idC);

    const list = run("list_drawings");
    expect(list).toContain("1 shape(s) on the globe:");
    expect(list).toContain(`- ${idR}:`);
    expect(list).not.toContain(`- ${idC}:`);
  });

  it("reports not found for an unknown id without touching entities", () => {
    run("draw_circle", { longitude: 0, latitude: 0, radius: 100 });
    expect(run("remove_drawing", { id: "rectangle-999" })).toBe(
      'No shape with id "rectangle-999". Call list_drawings to see current shape ids.',
    );
    expect(mocks.entities.removeById).not.toHaveBeenCalled();
  });

  it("reports nothing to remove when no shapes are present", () => {
    expect(run("remove_drawing", { id: "circle-1" })).toBe(
      'No shapes on the globe; cannot remove "circle-1".',
    );
    expect(mocks.entities.removeById).not.toHaveBeenCalled();
  });
});

describe("clear_drawings", () => {
  it("removes all drawn shapes after something has been drawn", () => {
    run("draw_circle", { longitude: 0, latitude: 0, radius: 100 });
    expect(mocks.addedEntities.length).toBe(1);

    const result = run("clear_drawings");
    expect(result).toBe("Cleared all drawn shapes.");
    expect(mocks.entities.removeAll).toHaveBeenCalledTimes(1);
    expect(mocks.addedEntities.length).toBe(0);
    // After clearing, the list is empty again.
    expect(run("list_drawings")).toBe("No shapes on the globe.");
  });

  it("reports nothing to clear when no shapes are present", () => {
    const result = run("clear_drawings");
    expect(result).toBe("No shapes to clear.");
  });

  it("reports nothing to clear when the viewer is absent", () => {
    run("draw_circle", { longitude: 0, latitude: 0, radius: 100 });
    mocks.getViewer.mockReturnValue(null);
    expect(run("clear_drawings")).toBe("No shapes to clear.");
  });
});
