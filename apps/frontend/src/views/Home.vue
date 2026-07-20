<script setup lang="ts">
import { onMounted } from "vue";
import { useHealthStore } from "../stores/health";

const health = useHealthStore();

onMounted(() => {
  void health.fetchHealth();
});
</script>

<template>
  <main class="wrap">
    <h1>Web Agent</h1>
    <section class="card">
      <h2>Backend health</h2>
      <p v-if="health.loading" class="muted">Checking…</p>
      <p v-else-if="health.error" class="err">
        Error: {{ health.error }}
      </p>
      <dl v-else-if="health.data">
        <dt>Status</dt>
        <dd>{{ health.data.status }}</dd>
        <dt>Service</dt>
        <dd>{{ health.data.service }}</dd>
        <dt>Time</dt>
        <dd>{{ health.data.time }}</dd>
      </dl>
      <button type="button" @click="health.fetchHealth()">Refresh</button>
    </section>
  </main>
</template>

<style scoped>
.wrap {
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 24px;
}

h1 {
  font-size: 2rem;
  margin-bottom: 24px;
}

.card {
  background: var(--card);
  border-radius: 8px;
  padding: 24px;
}

h2 {
  margin-top: 0;
}

dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 16px;
  margin: 0 0 16px;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
}

.muted {
  color: var(--muted);
}

.err {
  color: #fca5a5;
}

button {
  background: var(--accent);
  color: #06281b;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font: inherit;
  cursor: pointer;
}

button:hover {
  filter: brightness(1.05);
}
</style>
