import type { Group, Profile } from "~/utils/format";

// Profile cache shared across pages (replaces ensureProfiles).
export function useProfiles() {
  const profiles = useState<Record<string, Profile>>("profiles", () => ({}));

  function nameOf(id: string, me: Profile | null): string {
    if (me && id === me.id) return me.name || me.username || "Someone";
    return profiles.value[id]?.name || "Someone";
  }

  async function ensure(ids: string[]) {
    const missing = [
      ...new Set(ids.filter((id) => id && !profiles.value[id])),
    ];
    if (!missing.length) return;
    try {
      const list = await $fetch<Profile[]>(
        "/api/users?ids=" + encodeURIComponent(missing.join(",")),
      );
      list.forEach((p) => {
        profiles.value[p.id] = p;
      });
    } catch {
      // best effort
    }
  }

  return { profiles, nameOf, ensure };
}

export function useGroups() {
  const { ensure } = useProfiles();
  const {
    data: groups,
    pending,
    refresh,
  } = useAsyncData<Group[]>("groups", async () => {
    const list = await $fetch<Group[]>("/api/groups");
    const ids: string[] = [];
    list.forEach((g) => (g.memberIds || []).forEach((id) => ids.push(id)));
    await ensure(ids);
    return list;
  });
  return { groups, pending, refresh };
}
