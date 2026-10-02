<script setup lang="ts">
const { locale, setLocale } = useI18n();

const languages = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
] as const;

function switchLocale(code: "es" | "en") {
  setLocale(code);
}
</script>

<template>
  <div class="lang-switcher">
    <button
      v-for="lang in languages"
      :key="lang.code"
      class="lang-btn"
      :class="{ active: locale === lang.code }"
      @click="switchLocale(lang.code)"
    >
      {{ lang.label }}
    </button>
  </div>
</template>

<style scoped>
.lang-switcher {
  display: flex;
  gap: 2px;
  background: var(--bg-sunken);
  border-radius: 999px;
  padding: 2px;
}
.lang-btn {
  border: none;
  background: none;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-faint);
  cursor: pointer;
  border-radius: 999px;
  font-family: var(--sans);
  white-space: nowrap;
}
.lang-btn.active {
  background: var(--bg-elevated);
  color: var(--ink);
}
</style>
