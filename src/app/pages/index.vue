<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import { useGroups, useProfiles } from "~/composables/useGroups";
import AccountMenu from "~/components/AccountMenu.vue";
import GroupModal from "~/components/GroupModal.vue";

const { t } = useI18n();
const { user, pending: authPending, fetchMe } = useAuth();
const { groups, pending: groupsPending, refresh } = useGroups();
const { profiles } = useProfiles();
const showNewGroup = ref(false);
const toast = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, 2400);
}

function avatarBg(id: string): string {
  return profiles.value[id]?.color || "#8B978F";
}

function avatarInitial(id: string): string {
  if (user.value && id === user.value.id)
    return (user.value.name || "Y").trim().charAt(0).toUpperCase();
  return (profiles.value[id]?.name || "?").trim().charAt(0).toUpperCase();
}

function avatarTitle(id: string): string {
  if (user.value && id === user.value.id) return user.value.name;
  return profiles.value[id]?.name || "?";
}

onMounted(async () => {
  const me = await fetchMe();
  if (!me) {
    await navigateTo("/login");
    return;
  }
  await refresh();
});
</script>

<template>
  <div>
    <div class="topbar">
      <div class="brand"><span class="mark">P</span>{{ t("common.appName") }}</div>
      <div class="spacer"></div>
      <AccountMenu v-if="user" :user="user" />
    </div>
    <main>
      <div v-if="authPending || groupsPending" class="empty">
        <span class="icon">🧾</span>
        <h3>{{ t("groups.loading") }}</h3>
      </div>
      <div v-else-if="!groups || !groups.length" class="empty">
        <span class="icon">🪙</span>
        <h3>{{ t("groups.empty") }}</h3>
        <p>{{ t("groups.emptyDescription") }}</p>
      </div>
      <div v-else>
        <div class="section-label">{{ t("groups.title") }}</div>
        <div
          v-for="g in groups"
          :key="g.id"
          class="group-card"
          @click="navigateTo(`/g/${g.id}`)"
        >
          <div class="group-emoji">{{ g.emoji || "🧾" }}</div>
          <div class="group-info">
            <div class="name">{{ g.name }}</div>
            <div class="sub">
              <span class="avatar-stack">
                <div
                  v-for="id in (g.memberIds || []).slice(0, 4)"
                  :key="id"
                  class="avatar"
                  :style="{
                    background: avatarBg(id),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '11px',
                  }"
                  :title="avatarTitle(id)"
                >
                  {{ avatarInitial(id) }}
                </div>
              </span>
              &nbsp;{{ t("groups.members", (g.memberIds || []).length) }}
            </div>
          </div>
        </div>
      </div>
    </main>
    <div class="fab-bar">
      <div class="inner">
        <button class="fab primary" @click="showNewGroup = true">
          {{ t("groups.new") }}
        </button>
      </div>
    </div>
    <GroupModal
      v-if="showNewGroup"
      @close="showNewGroup = false"
      @created="
        showNewGroup = false;
        refresh();
      "
      @error="showToast($event)"
    />
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>
