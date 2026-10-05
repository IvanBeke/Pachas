<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import { useProfiles } from "~/composables/useGroups";
import { useGroupDetail } from "~/composables/useGroupDetail";
import type { Expense, RecurringExpense } from "~/utils/format";
import ExpenseModal from "~/components/ExpenseModal.vue";
import SettleModal from "~/components/SettleModal.vue";
import AddMemberModal from "~/components/AddMemberModal.vue";
import RecurringModal from "~/components/RecurringModal.vue";
import AccountMenu from "~/components/AccountMenu.vue";
import ExpensesTab from "~/components/group/ExpensesTab.vue";
import BalancesTab from "~/components/group/BalancesTab.vue";
import ActivityTab from "~/components/group/ActivityTab.vue";
import RecurringTab from "~/components/group/RecurringTab.vue";
import { GroupRole } from "../../../../shared/group-roles";

const { t } = useI18n();

const route = useRoute();
const gid = String(route.params.id);
const { user, fetchMe } = useAuth();
const { profiles, nameOf, ensure } = useProfiles();
const { group, expenses, settlements, balances, transfers, loading, reload } =
  useGroupDetail(gid);
const { load: loadCategories } = useCategories();

const tab = ref<"expenses" | "balances" | "activity" | "recurring">("expenses");
const showExpense = ref(false);
const editingExpense = ref<Expense | null>(null);
const showSettle = ref(false);
const showAddMember = ref(false);
const settlePreset = ref<{ from: string; to: string } | undefined>(undefined);
const toast = ref<string | null>(null);
const confirmDelete = ref<string | null>(null);
const recurring = ref<RecurringExpense[]>([]);
const showRecurringModal = ref(false);
const editingRecurring = ref<RecurringExpense | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, 2400);
}

const isGroupElevated = computed(() => {
  const role = group.value?.members.find((m) => m.userId === user.value?.id)?.role;
  return role === GroupRole.Creator || role === GroupRole.Admin;
});

function avatarBg(id: string): string {
  return profiles.value[id]?.color || "#8B978F";
}

function avatarInitial(id: string): string {
  if (user.value && id === user.value.id)
    return (user.value.name || "Y").trim().charAt(0).toUpperCase();
  return (profiles.value[id]?.name || "?").trim().charAt(0).toUpperCase();
}

/** Two-click delete: the first click arms, the second (within 3s) confirms. */
function confirmTwice(key: string, action: () => Promise<void>) {
  if (confirmDelete.value === key) {
    confirmDelete.value = null;
    action().catch((e: unknown) => showToast((e as Error)?.message || t("group.couldntDelete")));
    return;
  }
  confirmDelete.value = key;
  setTimeout(() => {
    if (confirmDelete.value === key) confirmDelete.value = null;
  }, 3000);
}

function delExpense(eid: string) {
  confirmTwice("e:" + eid, async () => {
    await $fetch(`/api/groups/${gid}/expenses/${eid}`, { method: "DELETE" });
    await reload();
  });
}

function delSettlement(sid: string) {
  confirmTwice("s:" + sid, async () => {
    await $fetch(`/api/groups/${gid}/settlements/${sid}`, { method: "DELETE" });
    await reload();
  });
}

async function loadRecurring() {
  try {
    recurring.value = await $fetch<RecurringExpense[]>(`/api/groups/${gid}/recurring`);
  } catch {
    // ignore
  }
}

function openRecurring(r: RecurringExpense | null) {
  editingRecurring.value = r;
  showRecurringModal.value = true;
}

async function delRecurring(rid: string) {
  try {
    await $fetch(`/api/groups/${gid}/recurring/${rid}`, { method: "DELETE" });
    await loadRecurring();
  } catch (e: unknown) {
    showToast((e as Error)?.message || t("group.couldntDelete"));
  }
}

function onRecurringSaved() {
  showRecurringModal.value = false;
  editingRecurring.value = null;
  // Saving may have generated expenses that are already due.
  void loadRecurring();
  void reload();
}

function quickSettle(from: string, to: string) {
  settlePreset.value = { from, to };
  showSettle.value = true;
}

function openSettle() {
  settlePreset.value = undefined;
  showSettle.value = true;
}

function openExpense(e: Expense | null) {
  editingExpense.value = e;
  showExpense.value = true;
}

function closeExpense() {
  showExpense.value = false;
  editingExpense.value = null;
}

onMounted(async () => {
  const me = await fetchMe();
  if (!me) {
    await navigateTo("/login");
    return;
  }
  await Promise.all([ensure([me.id]), loadCategories()]);
});
</script>

<template>
  <div>
    <div class="topbar">
      <button class="back-btn" @click="navigateTo('/')">‹ {{ t("common.groups") }}</button>
      <div class="spacer"></div>
      <AccountMenu v-if="user" :user="user" />
    </div>
    <main>
      <div v-if="loading || !group" class="empty">
        <span class="icon">🧾</span>
        <h3>{{ t("group.loading") }}</h3>
      </div>
      <template v-else-if="user">
        <div class="group-head">
          <div class="title">
            <h1>{{ group.emoji || "🧾" }} {{ group.name }}</h1>
          </div>
          <div class="meta">
            <span class="avatar-stack">
              <div
                v-for="id in group.memberIds"
                :key="id"
                class="avatar avatar-initial"
                :style="{ background: avatarBg(id) }"
                :title="nameOf(id, user)"
              >
                {{ avatarInitial(id) }}
              </div>
            </span>
            <button v-if="isGroupElevated" class="btn btn-sm" @click="showAddMember = true">
              {{ t("group.addPerson") }}
            </button>
            <button class="btn btn-sm" @click="navigateTo(`/g/${gid}/edit`)">
              {{ t("groupEdit.editGroup") }}
            </button>
            <span style="flex: 1"></span>
            <span style="font-size: 12px; color: var(--ink-faint)">{{
              group.baseCurrency
            }}</span>
          </div>
        </div>

        <div class="tabs">
          <button
            class="tab"
            :class="{ active: tab === 'expenses' }"
            @click="tab = 'expenses'"
          >
            {{ t("group.expenses") }}
          </button>
          <button
            class="tab"
            :class="{ active: tab === 'balances' }"
            @click="tab = 'balances'"
          >
            {{ t("group.balances") }}
          </button>
          <button
            class="tab"
            :class="{ active: tab === 'activity' }"
            @click="tab = 'activity'"
          >
            {{ t("group.activity") }}
          </button>
          <button
            class="tab"
            :class="{ active: tab === 'recurring' }"
            @click="tab = 'recurring'; loadRecurring()"
          >
            {{ t("group.recurring") }}
          </button>
        </div>

        <ExpensesTab
          v-if="tab === 'expenses'"
          :expenses="expenses"
          :me="user"
          :base-currency="group.baseCurrency"
          :can-manage-all="isGroupElevated"
          :confirm-delete="confirmDelete"
          @edit="openExpense"
          @delete="delExpense"
        />
        <BalancesTab
          v-if="tab === 'balances'"
          :member-ids="group.memberIds"
          :balances="balances"
          :transfers="transfers"
          :me="user"
          :base-currency="group.baseCurrency"
          :is-elevated="isGroupElevated"
          @settle="quickSettle"
        />
        <ActivityTab
          v-if="tab === 'activity'"
          :expenses="expenses"
          :settlements="settlements"
          :me="user"
          :base-currency="group.baseCurrency"
          :confirm-delete="confirmDelete"
          @delete-settlement="delSettlement"
        />
        <RecurringTab
          v-if="tab === 'recurring'"
          :recurring="recurring"
          :me="user"
          :base-currency="group.baseCurrency"
          :can-manage-all="isGroupElevated"
          @add="openRecurring(null)"
          @edit="openRecurring"
          @delete="delRecurring"
        />
      </template>
    </main>
    <div v-if="group" class="fab-bar">
      <div class="inner">
        <button class="fab" @click="openSettle">{{ t("group.settleUp") }}</button>
        <button class="fab primary" @click="openExpense(null)">
          {{ t("group.addExpense") }}
        </button>
      </div>
    </div>

    <ExpenseModal
      v-if="showExpense && group && user"
      :key="editingExpense?.id || 'new'"
      :group="group"
      :me="user"
      :initial="editingExpense"
      @close="closeExpense"
      @saved="
        closeExpense();
        reload();
      "
      @error="showToast($event)"
    />
    <SettleModal
      v-if="showSettle && group && user"
      :group="group"
      :me="user"
      :preset="settlePreset"
      :plan="transfers"
      @close="showSettle = false"
      @saved="
        showSettle = false;
        reload();
      "
      @error="showToast($event)"
    />
    <AddMemberModal
      v-if="showAddMember && group"
      :group-id="gid"
      :group-name="group.name"
      :existing="group.memberIds"
      @close="showAddMember = false"
      @added="
        showAddMember = false;
        reload();
      "
      @error="showToast($event)"
    />
    <RecurringModal
      v-if="showRecurringModal && group && user"
      :group="group"
      :me="user"
      :initial="editingRecurring"
      @close="showRecurringModal = false; editingRecurring = null"
      @saved="onRecurringSaved"
      @error="showToast($event)"
    />
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.avatar-initial {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: 11px;
}
</style>
