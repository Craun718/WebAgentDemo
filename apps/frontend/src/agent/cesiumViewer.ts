import * as Cesium from "cesium";

let viewer: Cesium.Viewer | null = null;

export function setViewer(v: Cesium.Viewer | null): void {
    viewer = v;
}

export function getViewer(): Cesium.Viewer | null {
    return viewer;
}
