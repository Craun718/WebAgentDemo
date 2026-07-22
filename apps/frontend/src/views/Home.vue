<script setup lang="ts">
import { onMounted } from "vue";
import { useHealthStore } from "../stores/health";
import { useAuthStore } from "../stores/auth";
import { RouterLink, useRouter } from "vue-router";

const health = useHealthStore();
const auth = useAuthStore();
const router = useRouter();

onMounted(() => {
  void health.fetchHealth();
  void auth.fetchNow();
});

function handleLogout() {
  auth.logout();
  void router.push("/login");
}
</script>

<template>
  <main class="wrap">
    <header class="header">
      <h1>Web Agent</h1>
      <nav class="header-actions">
        <RouterLink to="/chat" class="nav-link">Chat</RouterLink>
        <button type="button" class="logout-btn" @click="handleLogout">
          Logout
        </button>
      </nav>
    </header>
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

    <section class="card" style="margin-top: 16px">
      <h2>Server time</h2>
      <p v-if="auth.serverTime" class="time">
        {{ auth.serverTime }}
      </p>
      <p v-else class="muted">Fetching…</p>
    </section>
  </main>
</template>

<style scoped>
.wrap {
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 24px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

h1 {
  font-size: 2rem;
  margin: 0;
}

.logout-btn {
  background: none;
  border: 1px solid #2a2f3a;
  border-radius: 8px;
  color: var(--muted);
  padding: 8px 16px;
  font: inherit;
  cursor: pointer;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-link {
  color: var(--muted);
  text-decoration: none;
  padding: 8px 16px;
  border-radius: 8px;
  font: inherit;
}

.nav-link:hover {
  color: var(--fg);
  background: rgba(255, 255, 255, 0.04);
}

.logout-btn:hover {
  color: var(--fg);
  border-color: var(--fg);
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

.time {
  margin: 0;
  font-variant-numeric: tabular-nums;
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
