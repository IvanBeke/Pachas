import type { Expense, Group, Settlement } from "~/utils/format";
import { useProfiles } from "./useGroups";

/** Poll quickly while things change, then back off while the group is idle. */
const POLL_MIN_MS = 4_000;
const POLL_MAX_MS = 30_000;

export interface Balance {
  memberId: string;
  /** Positive = is owed, negative = owes. In the group's base currency. */
  amount: number;
}

export interface SuggestedTransfer {
  from: string;
  to: string;
  amount: number;
}

interface Summary {
  group: Group;
  expenses: Expense[];
  settlements: Settlement[];
  plan: { balances: Balance[]; transfers: SuggestedTransfer[] };
}

/**
 * Group detail with background polling. Polling only mutates the
 * group/expenses/settlements/plan refs — modal components hold their own local
 * reactive form state, so refreshes never wipe what the user is typing.
 *
 * Everything comes from `/summary`, which answers 304 when nothing changed, so
 * an idle group costs one cheap request per poll. Balances and suggested
 * transfers come from the server rather than being derived here: the same
 * figures decide what the server will accept when a settlement is recorded.
 */
export function useGroupDetail(gid: string) {
  const { ensure } = useProfiles();
  const group = ref<Group | null>(null);
  const expenses = ref<Expense[]>([]);
  const settlements = ref<Settlement[]>([]);
  const balances = ref<Balance[]>([]);
  const transfers = ref<SuggestedTransfer[]>([]);
  const loading = ref(true);
  let etag: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let delay = POLL_MIN_MS;

  async function fetchSummary(background: boolean): Promise<boolean> {
    const res = await fetch(`/api/groups/${gid}/summary`, {
      headers: etag ? { "if-none-match": etag } : {},
      credentials: "same-origin",
    });
    if (res.status === 304) return false;
    if (!res.ok) {
      if (!background && (res.status === 403 || res.status === 404)) {
        await navigateTo("/");
      }
      if (res.status === 401) await navigateTo("/login");
      return false;
    }
    const data = (await res.json()) as Summary;
    if (stopped) return false;
    etag = res.headers.get("etag");
    group.value = data.group;
    expenses.value = data.expenses;
    settlements.value = data.settlements;
    balances.value = data.plan.balances;
    transfers.value = data.plan.transfers;
    await ensure(data.group.memberIds || []);
    return true;
  }

  function load(background = false): Promise<void> {
    // Never stack requests: a slow response is awaited, not raced.
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const changed = await fetchSummary(background);
        delay = changed ? POLL_MIN_MS : Math.min(delay * 1.5, POLL_MAX_MS);
      } catch {
        delay = Math.min(delay * 2, POLL_MAX_MS);
      } finally {
        loading.value = false;
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => {
      if (!document.hidden) await load(true);
      schedule();
    }, delay);
  }

  function onVisible() {
    if (document.hidden) return;
    delay = POLL_MIN_MS;
    void load(true);
  }

  onMounted(async () => {
    stopped = false;
    await load();
    schedule();
    document.addEventListener("visibilitychange", onVisible);
  });

  onUnmounted(() => {
    stopped = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
  });

  return {
    group,
    expenses,
    settlements,
    balances,
    transfers,
    loading,
    /** Refetch now (after a local write) and resume fast polling. */
    reload: async () => {
      delay = POLL_MIN_MS;
      // A poll that started before the caller's write may not include it.
      if (inFlight) await inFlight;
      await load(true);
    },
  };
}
