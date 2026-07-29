<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import * as Cesium from "cesium";

const container = ref<HTMLDivElement | null>(null);
let viewer: Cesium.Viewer | null = null;

// Set default Ion token (free tier; works for development)
Cesium.Ion.defaultAccessToken =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJhM2QxNzQ2MC04YmVhLTQyMGUtYmI1MC0yZDU3MDY1ZWIyNDMiLCJpZCI6Mjg3NzQxLCJpYXQiOjE3NDM0MzUyNjB9.1lUAm9uEQ1G_jXnlvE4kSE3h3AXQpFpwYfKjjFq5F8c";

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
});

onUnmounted(() => {
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
