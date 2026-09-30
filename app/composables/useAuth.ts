import type { Profile } from "~/utils/format";

export function useAuth() {
  const user = useState<Profile | null>("auth-user", () => null);
  const pending = useState("auth-pending", () => true);

  async function fetchMe() {
    try {
      user.value = await $fetch<Profile>("/api/me");
    } catch {
      user.value = null;
    } finally {
      pending.value = false;
    }
    return user.value;
  }

  async function login(username: string, password: string) {
    user.value = await $fetch<Profile>("/api/login", {
      method: "POST",
      body: { username, password },
    });
    await navigateTo("/");
    return user.value;
  }

  async function register(username: string, password: string, name: string) {
    user.value = await $fetch<Profile>("/api/register", {
      method: "POST",
      body: { username, password, name },
    });
    await navigateTo("/");
    return user.value;
  }

  async function logout() {
    await $fetch("/api/logout", { method: "POST" }).catch(() => {});
    user.value = null;
    await navigateTo("/login");
  }

  return { user, pending, fetchMe, login, register, logout };
}
