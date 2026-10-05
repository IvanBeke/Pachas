import type { Group, Profile } from "~/utils/format";

/** Ids currently being fetched, so concurrent callers share one request. */
const inFlight = new Map<string, Promise<void>>();

// Profile cache shared across pages.
export function useProfiles() {
  const profiles = useState<Record<string, Profile>>("profiles", () => ({}));

  function nameOf(id: string, me: Profile | null): string {
    if (me && id === me.id) return me.name || me.username || "Someone";
    return profiles.value[id]?.name || "Someone";
  }

  async function ensure(ids: string[]) {
    const unique = [...new Set(ids.filter((id) => id && !profiles.value[id]))];
    const waiting = unique.flatMap((id) => {
      const p = inFlight.get(id);
      return p ? [p] : [];
    });
    const missing = unique.filter((id) => !inFlight.has(id));
    if (missing.length) {
      const request = (async () => {
        try {
          // The server caps a request at 100 ids.
          for (let i = 0; i < missing.length; i += 100) {
            const chunk = missing.slice(i, i + 100);
            const list = await $fetch<Profile[]>(
              "/api/users?ids=" + encodeURIComponent(chunk.join(",")),
            );
            list.forEach((p) => {
              profiles.value[p.id] = p;
            });
          }
        } catch {
          // best effort
        } finally {
          missing.forEach((id) => inFlight.delete(id));
        }
      })();
      missing.forEach((id) => inFlight.set(id, request));
      waiting.push(request);
    }
    await Promise.all(waiting);
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
