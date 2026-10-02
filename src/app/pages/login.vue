<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";

const { t } = useI18n();
const { user, pending, fetchMe, login, register } = useAuth();
const mode = ref<"login" | "register">("login");
const username = ref("");
const displayName = ref("");
const password = ref("");
const error = ref<string | null>(null);
const regClosed = ref(false);
const submitting = ref(false);

onMounted(async () => {
  const me = await fetchMe();
  if (me) {
    await navigateTo("/");
    return;
  }
  try {
    const cfg = await $fetch<{ allowRegistration: boolean; hasUsers: boolean }>(
      "/api/config",
    );
    mode.value = cfg.hasUsers ? "login" : "register";
    regClosed.value = !cfg.allowRegistration;
  } catch {
    // defaults stand
  }
});

async function submit() {
  error.value = null;
  submitting.value = true;
  try {
    if (mode.value === "login") {
      await login(username.value.trim(), password.value);
    } else {
      await register(
        username.value.trim(),
        password.value,
        displayName.value.trim(),
      );
    }
  } catch (e: unknown) {
    error.value =
      (e as { data?: { message?: string } })?.data?.message ||
      (e as Error)?.message ||
      t("auth.requestFailed");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="brand"><span class="mark">P</span>{{ t("common.appName") }}</div>
      <p v-if="mode === 'register'" class="tag">{{ t("auth.tagline") }}</p>
      <div v-if="error" class="auth-error">{{ error }}</div>
      <div v-if="mode === 'register' && regClosed" class="auth-error">
        {{ t("auth.registrationDisabled") }}
      </div>
      <form @submit.prevent="submit">
        <div class="field">
          <label>{{ t("auth.username") }}</label>
          <input
            v-model="username"
            type="text"
            autocomplete="username"
            required
          />
        </div>
        <div v-if="mode === 'register'" class="field">
          <label>{{ t("auth.displayName") }}</label>
          <input
            v-model="displayName"
            type="text"
            autocomplete="name"
            :placeholder="t('auth.displayNamePlaceholder')"
          />
        </div>
        <div class="field">
          <label>{{ t("auth.password") }}</label>
          <input
            v-model="password"
            type="password"
            :autocomplete="
              mode === 'login' ? 'current-password' : 'new-password'
            "
            required
          />
        </div>
        <button
          type="submit"
          class="btn btn-block btn-accent"
          :disabled="submitting || pending"
        >
          {{ mode === "login" ? t("auth.login") : t("auth.createAccountButton") }}
        </button>
      </form>
      <div class="auth-switch">
        <template v-if="mode === 'login'">
          {{ t("auth.newHere") }}
          <a @click="mode = 'register'">{{ t("auth.createAccountLink") }}</a>
        </template>
        <template v-else>
          {{ t("auth.alreadyHave") }} <a @click="mode = 'login'">{{ t("auth.loginLink") }}</a>
        </template>
      </div>
    </div>
  </div>
</template>
