<script setup lang="ts">
import type { Profile } from "~/utils/format";
import { useAuth } from "~/composables/useAuth";

const props = defineProps<{ user: Profile }>();

const { t } = useI18n();
const { logout } = useAuth();
</script>

<template>
  <div class="me-chip">
    <button
      class="profile-link"
      :aria-label="t('profile.title')"
      :title="t('profile.title')"
      @click="navigateTo('/profile')"
    >
      <div
        class="avatar"
        :style="{
          background: props.user.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 700,
          fontSize: '11px',
        }"
        :title="props.user.name"
      >
        {{ (props.user.name || "Y").trim().charAt(0).toUpperCase() }}
      </div>
      <span>{{ props.user.name || props.user.username }}</span>
    </button>
    <button
      v-if="props.user.role === 'admin'"
      class="btn btn-sm"
      style="margin-left: 2px"
      @click="navigateTo('/admin')"
    >
      {{ t("common.admin") }}
    </button>
    <button class="btn btn-ghost btn-sm" style="margin-left: 2px" @click="logout">
      {{ t("common.logOut") }}
    </button>
  </div>
</template>
