<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import OverviewTab from "~/components/admin/OverviewTab.vue";
import CategoriesTab from "~/components/admin/CategoriesTab.vue";
import TitleLinksTab from "~/components/admin/TitleLinksTab.vue";

const { t } = useI18n();

const { fetchMe } = useAuth();
const tab = ref<"overview" | "categories" | "links">("overview");
const ready = ref(false);
const toast = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, 2400);
}

onMounted(async () => {
  const me = await fetchMe();
  if (!me) {
    await navigateTo("/login");
    return;
  }
  if (me.role !== "admin") {
    await navigateTo("/");
    return;
  }
  // Tabs load their own data, so they only mount once the user is known to be an admin.
  ready.value = true;
});
</script>

<template>
  <div>
    <div class="topbar">
      <button class="back-btn" @click="navigateTo('/')">‹ {{ t("common.groups") }}</button>
      <div class="brand"><span class="mark">P</span>{{ t("common.admin") }}</div>
      <div class="spacer"></div>
    </div>
    <main>
      <div class="tabs">
        <button
          class="tab"
          :class="{ active: tab === 'overview' }"
          @click="tab = 'overview'"
        >
          {{ t("admin.overview") }}
        </button>
        <button
          class="tab"
          :class="{ active: tab === 'categories' }"
          @click="tab = 'categories'"
        >
          {{ t("admin.categories") }}
        </button>
        <button
          class="tab"
          :class="{ active: tab === 'links' }"
          @click="tab = 'links'"
        >
          {{ t("admin.titleLinks") }}
        </button>
      </div>

      <template v-if="ready">
        <OverviewTab v-if="tab === 'overview'" @error="showToast" />
        <CategoriesTab v-else-if="tab === 'categories'" @error="showToast" />
        <TitleLinksTab v-else-if="tab === 'links'" @error="showToast" />
      </template>
    </main>
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>
