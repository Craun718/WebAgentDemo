<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { chatMessageContentToText, useChatStore } from "../stores/chat";

const chat = useChatStore();
const listEl = ref<HTMLDivElement | null>(null);

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
  chat.clear();
}

function onStop() {
  chat.stop();
}
</script>

<template>
  <section class="chat">
    <header class="chat-header">
      <h1>Chat</h1>
      <button type="button" class="ghost" :disabled="chat.streaming" @click="onClear">Clear</button>
    </header>

    <div ref="listEl" class="messages">
      <p v-if="!chat.messages.length" class="empty">Send a message to start the conversation.</p>
      <div v-for="(msg, i) in chat.messages" :key="i" class="bubble" :class="msg.role">
        <span class="role">{{ msg.role }}</span>
        <p class="text">{{ chatMessageContentToText(msg) }}</p>
      </div>
    </div>

    <p v-if="chat.error" class="error">{{ chat.error }}</p>

    <form class="composer" @submit.prevent="onSubmit">
      <textarea
        v-model="chat.input"
        placeholder="Type a message…"
        rows="1"
        :disabled="chat.streaming"
        @keydown.enter.exact.prevent="onSubmit"
      />
      <button v-if="!chat.streaming" type="submit" :disabled="!chat.input.trim()">Send</button>
      <button v-else type="button" class="stop" @click="onStop">Stop</button>
    </form>
  </section>
</template>

<style scoped>
.chat {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px 48px;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

h1 {
  font-size: 1.5rem;
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
  max-width: 80%;
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

.error {
  color: #fca5a5;
  font-size: 0.875rem;
  margin: 8px 0;
}

.composer {
  display: flex;
  gap: 8px;
  margin-top: 12px;
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
</style>
