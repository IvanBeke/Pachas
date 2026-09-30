<script setup lang="ts">
const { t } = useI18n();

useHead({
  title: t("common.appName") + " — " + t("common.tagline"),
});
</script>

<template>
  <div id="app">
    <NuxtPage />
  </div>
</template>
