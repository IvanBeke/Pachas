<script setup lang="ts">
const { t } = useI18n();

useHead({
  titleTemplate: (title) =>
    title ? `${title} · ${t("common.appName")}` : t("common.appName"),
});
</script>

<template>
  <div id="app">
    <NuxtPage />
  </div>
</template>
