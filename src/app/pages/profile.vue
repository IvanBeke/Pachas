<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import AccountMenu from "~/components/AccountMenu.vue";

const { t } = useI18n();
const { user, fetchMe, updateProfile } = useAuth();
const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);
const saved = ref(false);
const name = ref("");
const language = ref<"es" | "en">("es");
const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");

function profileError(error: unknown): string {
  const code = (error as { data?: { message?: string } })?.data?.message;
  const messages: Record<string, string> = {
    profile_username_immutable: t("profile.usernameReadOnly"),
    profile_name_invalid: t("profile.nameInvalid"),
    profile_locale_invalid: t("profile.languageInvalid"),
    profile_password_fields_required: t("profile.passwordFieldsRequired"),
    profile_password_too_short: t("profile.passwordTooShort"),
    profile_password_too_long: t("profile.passwordTooLong"),
    profile_current_password_incorrect: t("profile.currentPasswordIncorrect"),
    profile_nothing_to_update: t("profile.nothingToUpdate"),
  };
  return (code && messages[code]) || t("profile.saveFailed");
}

async function saveProfile() {
  error.value = null;
  saved.value = false;

  if (newPassword.value && newPassword.value !== confirmPassword.value) {
    error.value = t("profile.passwordMismatch");
    return;
  }
  if (currentPassword.value && !newPassword.value) {
    error.value = t("profile.passwordFieldsRequired");
    return;
  }

  saving.value = true;
  try {
    const payload: {
      name: string;
      locale: "es" | "en";
      currentPassword?: string;
      newPassword?: string;
    } = { name: name.value, locale: language.value };
    if (newPassword.value) {
      payload.currentPassword = currentPassword.value;
      payload.newPassword = newPassword.value;
    }
    await updateProfile(payload);
    currentPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    saved.value = true;
  } catch (e: unknown) {
    error.value = profileError(e);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const me = await fetchMe();
  if (!me) {
    await navigateTo("/login");
    return;
  }
  name.value = me.name;
  language.value = me.locale;
  loading.value = false;
});
</script>

<template>
  <div>
    <div class="topbar">
      <button class="back-btn" @click="navigateTo('/')">
        ‹ {{ t("common.groups") }}
      </button>
      <div class="spacer"></div>
      <AccountMenu v-if="user" :user="user" />
    </div>

    <main>
      <div v-if="loading" class="empty">
        <span class="icon">👤</span>
        <h3>{{ t("profile.loading") }}</h3>
      </div>
      <template v-else-if="user">
        <div class="group-head">
          <div class="title"><h1>{{ t("profile.title") }}</h1></div>
          <p class="profile-description">{{ t("profile.description") }}</p>
        </div>

        <form @submit.prevent="saveProfile">
          <section class="profile-section">
            <div class="section-label">{{ t("profile.account") }}</div>
            <div class="field">
              <label for="profile-username">{{ t("auth.username") }}</label>
              <input
                id="profile-username"
                :value="user.username"
                type="text"
                autocomplete="username"
                disabled
                aria-disabled="true"
              />
              <small>{{ t("profile.usernameReadOnly") }}</small>
            </div>
            <div class="field">
              <label for="profile-name">{{ t("auth.displayName") }}</label>
              <input
                id="profile-name"
                v-model="name"
                type="text"
                autocomplete="name"
                maxlength="60"
                required
              />
            </div>
            <div class="field">
              <label for="profile-language">{{ t("profile.language") }}</label>
              <select id="profile-language" v-model="language">
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </div>
          </section>

          <section class="profile-section">
            <div class="section-label">{{ t("profile.changePassword") }}</div>
            <p class="profile-description">{{ t("profile.passwordHint") }}</p>
            <div class="field">
              <label for="profile-current-password">
                {{ t("profile.currentPassword") }}
              </label>
              <input
                id="profile-current-password"
                v-model="currentPassword"
                type="password"
                autocomplete="current-password"
                :required="Boolean(newPassword)"
              />
            </div>
            <div class="field">
              <label for="profile-new-password">{{ t("profile.newPassword") }}</label>
              <input
                id="profile-new-password"
                v-model="newPassword"
                type="password"
                autocomplete="new-password"
                minlength="8"
                maxlength="72"
                :required="Boolean(currentPassword)"
              />
            </div>
            <div class="field">
              <label for="profile-confirm-password">
                {{ t("profile.confirmPassword") }}
              </label>
              <input
                id="profile-confirm-password"
                v-model="confirmPassword"
                type="password"
                autocomplete="new-password"
                :required="Boolean(newPassword)"
              />
            </div>
          </section>

          <div v-if="error" class="auth-error" role="alert">{{ error }}</div>
          <div v-if="saved" class="profile-success" role="status">
            {{ t("profile.saved") }}
          </div>
          <button
            type="submit"
            class="btn btn-block btn-accent"
            :disabled="saving"
          >
            {{ saving ? t("profile.saving") : t("common.save") }}
          </button>
        </form>
      </template>
    </main>
  </div>
</template>
