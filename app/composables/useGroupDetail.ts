import type { Expense, Group, Settlement } from "~/utils/format";
import { useProfiles } from "./useGroups";

const POLL_MS = 4000;

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

/**
 * Group detail with background polling. Polling only mutates the
 * group/expenses/settlements/plan refs — modal components hold their own local
 * reactive form state, so refreshes never wipe what the user is typing.
 *
 * Balances and suggested transfers come from the server (`/settlements/plan`)
 * rather than being derived here: the same figures decide what the server will
 * accept when a settlement is recorded, so the UI can never disagree with them.
 */
export function useGroupDetail(gid: string) {
  const { ensure } = useProfiles();
  const group = ref<Group | null>(null);
  const expenses = ref<Expense[]>([]);
  const settlements = ref<Settlement[]>([]);
  const balances = ref<Balance[]>([]);
  const transfers = ref<SuggestedTransfer[]>([]);
  const loading = ref(true);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function load(background = false) {
    try {
      const [g, e, s, plan] = await Promise.all([
        $fetch<Group>(`/api/groups/${gid}`),
        $fetch<Expense[]>(`/api/groups/${gid}/expenses`),
        $fetch<Settlement[]>(`/api/groups/${gid}/settlements`),
        $fetch<{ balances: Balance[]; transfers: SuggestedTransfer[] }>(
          `/api/groups/${gid}/settlements/plan`,
        ),
      ]);
      if (stopped) return;
      group.value = g;
      expenses.value = e;
      settlements.value = s;
      balances.value = plan.balances;
      transfers.value = plan.transfers;
      await ensure(g.memberIds || []);
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (!background && (status === 403 || status === 404)) {
        await navigateTo("/");
      }
    } finally {
      loading.value = false;
    }
  }

  onMounted(async () => {
    stopped = false;
    await load();
    timer = setInterval(() => {
      if (document.hidden) return;
      load(true);
    }, POLL_MS);
  });

  onUnmounted(() => {
    stopped = true;
    if (timer) clearInterval(timer);
  });

  return {
    group,
    expenses,
    settlements,
    balances,
    transfers,
    loading,
    reload: () => load(true),
  };
}
