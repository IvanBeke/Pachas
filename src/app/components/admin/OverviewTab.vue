<script setup lang="ts">
interface AdminUser {
  id: string;
  name: string;
  username: string;
  role: string;
  createdAt: number;
}
interface AdminGroup {
  id: string;
  name: string;
  emoji: string | null;
  baseCurrency: string;
  createdAt: number;
}
interface AdminData {
  counts: { users: number; groups: number; expenses: number; settlements: number };
  users: AdminUser[];
  groups: AdminGroup[];
}

const emit = defineEmits<{ error: [msg: string] }>();

const { t } = useI18n();

const data = ref<AdminData | null>(null);

onMounted(async () => {
  try {
    data.value = await $fetch<AdminData>("/api/admin/overview");
  } catch (e: unknown) {
    emit("error", (e as Error)?.message || t("admin.couldntLoad"));
  }
});
</script>

<template>
  <div>
    <div v-if="!data" class="empty">
      <span class="icon">📊</span>
      <h3>{{ t("admin.loading") }}</h3>
    </div>
    <template v-else>
      <div class="section-label">{{ t("admin.counts") }}</div>
      <div class="balance-row">
        <span class="name">{{ t("admin.users") }}</span>
        <span class="amt">{{ data.counts.users }}</span>
      </div>
      <div class="balance-row">
        <span class="name">{{ t("admin.groups") }}</span>
        <span class="amt">{{ data.counts.groups }}</span>
      </div>
      <div class="balance-row">
        <span class="name">{{ t("admin.expenses") }}</span>
        <span class="amt">{{ data.counts.expenses }}</span>
      </div>
      <div class="balance-row">
        <span class="name">{{ t("admin.settlements") }}</span>
        <span class="amt">{{ data.counts.settlements }}</span>
      </div>
      <div class="section-label" style="margin-top: 22px">{{ t("admin.users") }}</div>
      <div v-for="u in data.users" :key="u.id" class="balance-row">
        <span class="name">
          {{ u.name }}
          <span style="font-size: 12px; color: var(--ink-faint)">@{{ u.username }}</span>
        </span>
        <span class="amt" :class="u.role === 'admin' ? 'pos' : 'neu'" style="font-size: 12.5px">
          {{ u.role }}
        </span>
      </div>
      <div class="section-label" style="margin-top: 22px">{{ t("admin.groups") }}</div>
      <div v-for="g in data.groups" :key="g.id" class="balance-row">
        <span class="name">{{ g.emoji || "🧾" }} {{ g.name }}</span>
        <span class="amt" style="font-size: 12.5px">{{ g.baseCurrency }}</span>
      </div>
    </template>
  </div>
</template>
