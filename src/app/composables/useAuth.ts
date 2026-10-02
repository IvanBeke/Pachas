import type { Profile } from "~/utils/format";

type ProfileUpdate = {
  name: string;
  locale: Profile["locale"];
  currentPassword?: string;
  newPassword?: string;
};

export function useAuth() {
  const user = useState<Profile | null>("auth-user", () => null);
  const pending = useState("auth-pending", () => true);
  const { setLocale } = useI18n();

  async function acceptUser(profile: Profile | null) {
    user.value = profile;
    if (profile) await setLocale(profile.locale);
  }

  async function fetchMe() {
    try {
      await acceptUser(await $fetch<Profile>("/api/me"));
    } catch {
      user.value = null;
    } finally {
      pending.value = false;
    }
    return user.value;
  }

  async function login(username: string, password: string) {
    await acceptUser(await $fetch<Profile>("/api/login", {
      method: "POST",
      body: { username, password },
    }));
    await navigateTo("/");
    return user.value;
  }

  async function register(username: string, password: string, name: string) {
    await acceptUser(await $fetch<Profile>("/api/register", {
      method: "POST",
      body: { username, password, name },
    }));
    await navigateTo("/");
    return user.value;
  }

  async function updateProfile(payload: ProfileUpdate) {
    await acceptUser(await $fetch<Profile>("/api/me", {
      method: "PATCH",
      body: payload,
    }));
    return user.value;
  }

  async function logout() {
    await $fetch("/api/logout", { method: "POST" }).catch(() => {});
    user.value = null;
    await navigateTo("/login");
  }

  return { user, pending, fetchMe, login, register, updateProfile, logout };
}
