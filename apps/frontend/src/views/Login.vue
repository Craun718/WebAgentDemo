<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

const username = ref("admin");
const password = ref("admin");

async function handleSubmit() {
  const ok = await auth.login(username.value, password.value);
  if (ok) {
    await router.push("/");
  }
}
</script>

<template>
  <main class="login-wrap">
    <form class="login-card" @submit.prevent="handleSubmit">
      <h1>Sign In</h1>

      <label>
        Username
        <input v-model="username" type="text" autocomplete="username" />
      </label>

      <label>
        Password
        <input v-model="password" type="password" autocomplete="current-password" />
      </label>

      <p v-if="auth.error" class="error">{{ auth.error }}</p>

      <button type="submit" :disabled="auth.loading">
        {{ auth.loading ? "Signing in…" : "Sign In" }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.login-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  padding: 24px;
}

.login-card {
  background: var(--card);
  border-radius: 8px;
  padding: 32px;
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

h1 {
  margin: 0;
  font-size: 1.5rem;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.875rem;
  color: var(--muted);
}

input {
  background: var(--bg);
  border: 1px solid #2a2f3a;
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--fg);
  font: inherit;
  font-size: 1rem;
}

input:focus {
  outline: none;
  border-color: var(--accent);
}

.error {
  color: #fca5a5;
  margin: 0;
  font-size: 0.875rem;
}

button {
  background: var(--accent);
  color: #06281b;
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  font: inherit;
  font-size: 1rem;
  cursor: pointer;
  font-weight: 600;
}

button:hover:not(:disabled) {
  filter: brightness(1.05);
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
