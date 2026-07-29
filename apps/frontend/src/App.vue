<script setup lang="ts">
import { onMounted } from "vue";
import { useAuthStore } from "./stores/auth";
import { useHealthStore } from "./stores/health";
import { useChatStore, chatMessageContentToText } from "./stores/chat";
import { chatMessageToolCalls } from "./stores/chat";
import { ref, nextTick, watch } from "vue";

const auth = useAuthStore();
const health = useHealthStore();
const chat = useChatStore();
const listEl = ref<HTMLDivElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);

onMounted(() => {
  void health.fetchHealth();
  void auth.fetchNow();
});

function handleLogout() {
  chat.clear();
  auth.logout();
}

async function scrollToBottom() {
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
}

watch(() => chat.messages.length, scrollToBottom);
watch(() => chatMessageContentToText(chat.messages.at(-1)), scrollToBottom);

function onSubmit() {
  chat.send();
}

function onClear() {
  if (chat.messages.length > 0 && !window.confirm("Clear all messages?")) return;
  chat.clear();
  nextTick(() => inputEl.value?.focus());
}

function onStop() {
  chat.stop();
}

// ---- Login ----
import { ref as loginRef } from "vue";
import CesiumGlobe from "./components/CesiumGlobe.vue";

const username = loginRef("admin");
const password = loginRef("admin");

async function handleLogin() {
  const ok = await auth.login(username.value, password.value);
  if (ok) {
    void health.fetchHealth();
    void auth.fetchNow();
  }
}
</script>

<template>
  <!-- Login -->
  <main v-if="!auth.isAuthenticated" class="login-wrap">
    <form class="login-card" @submit.prevent="handleLogin">
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

  <!-- Main App -->
  <div v-else class="app-layout">
    <!-- Header -->
    <header class="header">
      <h1 class="header-title">Web Agent</h1>
      <div class="header-right">
        <span v-if="auth.serverTime" class="server-time">{{ auth.serverTime }}</span>
        <span v-else class="server-time muted">Loading…</span>
        <button type="button" class="logout-btn" @click="handleLogout">Logout</button>
      </div>
    </header>

    <!-- Chat -->
    <main class="chat-main">
      <div class="left-panel">
        <CesiumGlobe />
      </div>
      <div class="right-panel">
        <div class="chat-inner">
          <header class="chat-header">
            <h2>Chat</h2>
            <button type="button" class="ghost" @click="onClear">Clear</button>
          </header>

          <div ref="listEl" class="messages">
            <p v-if="!chat.messages.length" class="empty">
              Send a message to start the conversation.
            </p>
            <template v-for="(msg, i) in chat.messages" :key="i">
              <div v-if="msg.role !== 'tool'" class="bubble" :class="msg.role">
                <span class="role">{{ msg.role }}</span>
                <!-- Reasoning block: per-message, preserved across turns -->
                <details v-if="msg.role === 'assistant' && chat.reasoning[i]" class="reasoning">
                  <summary>Thinking</summary>
                  <pre>{{ chat.reasoning[i] }}</pre>
                </details>
                <p v-if="chatMessageContentToText(msg)" class="text">
                  {{ chatMessageContentToText(msg) }}
                </p>
                <div v-if="chatMessageToolCalls(msg).length" class="tool-calls">
                  <div v-for="(call, ci) in chatMessageToolCalls(msg)" :key="ci" class="tool-call">
                    <span class="tool-name">{{ call.name }}</span>
                    <code class="tool-args">{{ call.arguments || "{}" }}</code>
                    <code v-if="chat.toolResults[call.id]" class="tool-result"
                      >=> {{ chat.toolResults[call.id] }}</code
                    >
                  </div>
                </div>
              </div>
            </template>
          </div>

          <p v-if="chat.error" class="error">{{ chat.error }}</p>

          <form class="composer" @submit.prevent="onSubmit">
            <textarea
              ref="inputEl"
              v-model="chat.input"
              placeholder="Type a message…"
              rows="1"
              :disabled="chat.streaming"
              @keydown.enter.exact.prevent="onSubmit"
            />
            <button v-if="!chat.streaming" type="submit" :disabled="!chat.input.trim()">
              Send
            </button>
            <button v-else type="button" class="stop" @click="onStop">Stop</button>
          </form>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="footer">
      <template v-if="health.loading">Health: checking…</template>
      <template v-else-if="health.error">Health: {{ health.error }}</template>
      <template v-else-if="health.data">
        Health: {{ health.data.status }} · {{ health.data.service }} ·
        {{ health.data.time }}
      </template>
      <template v-else>Health: —</template>
    </footer>
  </div>
</template>

<style scoped>
/* ========= Layout ========= */
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* ========= Header ========= */
.header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: var(--card);
  border-bottom: 1px solid #2a2f3a;
}

.header-title {
  font-size: 1.25rem;
  margin: 0;
  white-space: nowrap;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.server-time {
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.muted {
  color: var(--muted);
}

.logout-btn {
  background: none;
  border: 1px solid #2a2f3a;
  border-radius: 8px;
  color: var(--muted);
  padding: 6px 16px;
  font: inherit;
  cursor: pointer;
}

.logout-btn:hover {
  color: var(--fg);
  border-color: var(--fg);
}

/* ========= Chat ========= */
.chat-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  align-items: stretch;
}

.left-panel {
  flex: 3;
}

.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-inner {
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 16px 16px 0;
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.chat-header h2 {
  font-size: 1.25rem;
  margin: 0;
}

.ghost {
  background: none;
  border: 1px solid #2a2f3a;
  border-radius: 8px;
  color: var(--muted);
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}

.ghost:hover:not(:disabled) {
  color: var(--fg);
  border-color: var(--fg);
}

.messages {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--card);
  border-radius: 12px;
}

.empty {
  color: var(--muted);
  margin: auto;
}

.bubble {
  max-width: 90%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bubble.user {
  align-self: flex-end;
  align-items: flex-end;
}

.bubble.assistant {
  align-self: flex-start;
}

.role {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.text {
  margin: 0;
  padding: 10px 14px;
  border-radius: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.bubble.user .text {
  background: var(--accent);
  color: #06281b;
}

.bubble.assistant .text {
  background: #1d222b;
}

.reasoning {
  margin-bottom: 6px;
  padding: 6px 10px;
  background: #14181f;
  border-left: 2px solid #5a5f6a;
  border-radius: 6px;
  font-size: 0.85rem;
  color: #9aa0ac;
}

.reasoning summary {
  cursor: pointer;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #7a808d;
  user-select: none;
}

.reasoning pre {
  margin: 6px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  font-family: inherit;
}

.tool-calls {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 6px;
}

.tool-call {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
  background: #14181f;
  border: 1px solid #2a2f3a;
  border-radius: 8px;
}

.tool-name {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--accent);
}

.tool-args {
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-result {
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
}

.error {
  color: #fca5a5;
  font-size: 0.875rem;
  margin: 8px 0;
}

.composer {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-shrink: 0;
  padding-bottom: 12px;
}

textarea {
  flex: 1;
  resize: none;
  background: var(--bg);
  border: 1px solid #2a2f3a;
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--fg);
  font: inherit;
}

textarea:focus {
  outline: none;
  border-color: var(--accent);
}

button[type="submit"] {
  background: var(--accent);
  color: #06281b;
  border: none;
  border-radius: 8px;
  padding: 0 20px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

button[type="submit"]:hover:not(:disabled) {
  filter: brightness(1.05);
}

button[type="submit"]:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.stop {
  background: none;
  border: 1px solid #7f1d1d;
  border-radius: 8px;
  color: #fca5a5;
  padding: 0 20px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.stop:hover {
  background: #7f1d1d;
  color: #fee2e2;
}

/* ========= Footer ========= */
.footer {
  flex-shrink: 0;
  padding: 8px 24px;
  text-align: center;
  font-size: 0.8rem;
  color: var(--muted);
  background: var(--card);
  border-top: 1px solid #2a2f3a;
}

/* ========= Login ========= */
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

.login-card h1 {
  margin: 0;
  font-size: 1.5rem;
}

.login-card label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.875rem;
  color: var(--muted);
}

.login-card input {
  background: var(--bg);
  border: 1px solid #2a2f3a;
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--fg);
  font: inherit;
  font-size: 1rem;
}

.login-card input:focus {
  outline: none;
  border-color: var(--accent);
}

.login-card .error {
  color: #fca5a5;
  margin: 0;
  font-size: 0.875rem;
}

.login-card button {
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

.login-card button:hover:not(:disabled) {
  filter: brightness(1.05);
}

.login-card button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
