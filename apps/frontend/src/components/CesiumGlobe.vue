<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import * as Cesium from "cesium";
import { setViewer } from "../agent/cesiumViewer";

const container = ref<HTMLDivElement | null>(null);
let viewer: Cesium.Viewer | null = null;

// Set default Ion token (free tier; works for development)
const cesiumToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
Cesium.Ion.defaultAccessToken = cesiumToken;

onMounted(() => {
  if (!container.value) return;
  viewer = new Cesium.Viewer(container.value, {
    animation: false,
    timeline: false,
    fullscreenButton: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    geocoder: false,
    baseLayerPicker: false,
    infoBox: false,
    selectionIndicator: false,
  });
  setViewer(viewer);
});

onUnmounted(() => {
  setViewer(null);
  if (viewer) {
    viewer.destroy();
    viewer = null;
  }
});
</script>

<template>
  <div ref="container" class="cesium-container" />
</template>

<style scoped>
.cesium-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
