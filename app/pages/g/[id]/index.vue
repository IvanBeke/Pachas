<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import { useProfiles } from "~/composables/useGroups";
import { useGroupDetail } from "~/composables/useGroupDetail";
import {
  fmt,
  dateLabel,
  timeAgo,
  parseItems,
  type Category,
  type Expense,
  type RecurringExpense,
} from "~/utils/format";
import ExpenseModal from "~/components/ExpenseModal.vue";
import SettleModal from "~/components/SettleModal.vue";
import AddMemberModal from "~/components/AddMemberModal.vue";
import RecurringModal from "~/components/RecurringModal.vue";
import LanguageSwitcher from "~/components/LanguageSwitcher.vue";

const { t } = useI18n();

const route = useRoute();
const gid = String(route.params.id);
const { user, fetchMe, logout } = useAuth();
const { profiles, nameOf, ensure } = useProfiles();
const { group, expenses, settlements, balances, transfers, loading, reload } =
  useGroupDetail(gid);
const categories = ref<Category[]>([]);
const categoryIcon = (id: string): string =>
  categories.value.find((c) => String(c.id) === id)?.icon ?? "🧾";

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

function expTitle(e: Pick<Expense, "title" | "description">): string {
  return e.title || e.description;
}

// One-line summary for items-split expenses
// ("3 items · Ramen, Gyoza · +tax · +18% tip").
// Falls back to the raw description when it isn't an items payload.
function expSubtitle(e: Expense): string | null {
  if (e.splitType === "items") {
    const parsed = parseItems(e.description);
    if (!parsed) return e.description || null;
    const names = parsed.items
      .map((it) => it.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    const n = parsed.items.length;
    let s = `${n} ${t("expenseModal.splitItems")}` + (names ? ` · ${names}` : "");
    if (parsed.tax > 0) s += " · +tax";
    if (parsed.tipPercent > 0) s += ` · +${parsed.tipPercent}% tip`;
    return s;
  }
  return e.title && e.description ? e.description : null;
}

// Server-provided figures. `balances` is an array; look up by member id.
function balanceOf(id: string): number {
  return balances.value.find((b) => b.memberId === id)?.amount ?? 0;
}

const activity = computed(() => {
  const items: { type: string; ts: number; data: unknown }[] = [];
  expenses.value.forEach((e) =>
    items.push({ type: "expense", ts: e.createdAt || 0, data: e }),
  );
  settlements.value.forEach((s) =>
    items.push({ type: "settlement", ts: s.createdAt || 0, data: s }),
  );
  items.sort((a, b) => b.ts - a.ts);
  return items;
});

function avatarBg(id: string): string {
  return profiles.value[id]?.color || "#8B978F";
}

function avatarInitial(id: string): string {
  if (user.value && id === user.value.id)
    return (user.value.name || "Y").trim().charAt(0).toUpperCase();
  return (profiles.value[id]?.name || "?").trim().charAt(0).toUpperCase();
}

async function delExpense(eid: string) {
  if (confirmDelete.value === "e:" + eid) {
    try {
      await $fetch(`/api/groups/${gid}/expenses/${eid}`, { method: "DELETE" });
      await reload();
    } catch (e: unknown) {
      showToast((e as Error)?.message || t("group.couldntDelete"));
    }
    confirmDelete.value = null;
  } else {
    confirmDelete.value = "e:" + eid;
    setTimeout(() => {
      if (confirmDelete.value === "e:" + eid) confirmDelete.value = null;
    }, 3000);
  }
}

async function delSettlement(sid: string) {
  if (confirmDelete.value === "s:" + sid) {
    try {
      await $fetch(`/api/groups/${gid}/settlements/${sid}`, {
        method: "DELETE",
      });
      await reload();
    } catch (e: unknown) {
      showToast((e as Error)?.message || t("group.couldntDelete"));
    }
    confirmDelete.value = null;
  } else {
    confirmDelete.value = "s:" + sid;
    setTimeout(() => {
      if (confirmDelete.value === "s:" + sid) confirmDelete.value = null;
    }, 3000);
  }
}

async function loadRecurring() {
  try {
    recurring.value = await $fetch<RecurringExpense[]>(
      `/api/groups/${gid}/recurring`,
    );
  } catch {
    // ignore
  }
}

function editRecurring(r: RecurringExpense) {
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

function quickSettle(from: string, to: string) {
  settlePreset.value = { from, to };
  showSettle.value = true;
}

function openSettle() {
  settlePreset.value = undefined;
  showSettle.value = true;
}

function openEditExpense(e: Expense) {
  editingExpense.value = e;
  showExpense.value = true;
}

function openNewExpense() {
  editingExpense.value = null;
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
  await ensure([me.id]);
  try {
    categories.value = await $fetch<Category[]>("/api/categories");
  } catch {
    // fallback icons
  }
});
</script>

<template>
  <div>
    <div class="topbar">
      <button class="back-btn" @click="navigateTo('/')">‹ {{ t("common.groups") }}</button>
      <div class="spacer"></div>
      <LanguageSwitcher />
      <div v-if="user" class="me-chip">
        <div
          class="avatar"
          :style="{
            background: avatarBg(user.id),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: '11px',
          }"
          :title="user.name"
        >
          {{ (user.name || "Y").trim().charAt(0).toUpperCase() }}
        </div>
        <span>{{ user.name || user.username }}</span>
        <button
          v-if="user.role === 'admin'"
          class="btn btn-sm"
          style="margin-left: 2px"
          @click="navigateTo('/admin')"
        >
          {{ t("common.admin") }}
        </button>
        <button
          class="btn btn-ghost btn-sm"
          style="margin-left: 2px"
          @click="logout"
        >
          {{ t("common.logOut") }}
        </button>
      </div>
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
                class="avatar"
                :style="{
                  background: avatarBg(id),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '11px',
                }"
                :title="nameOf(id, user)"
              >
                {{ avatarInitial(id) }}
              </div>
            </span>
            <button class="btn btn-sm" @click="showAddMember = true">
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

        <!-- Expenses tab -->
        <div v-if="tab === 'expenses'">
          <div v-if="!expenses.length" class="empty">
            <span class="icon">🧾</span>
            <h3>{{ t("group.noExpenses") }}</h3>
            <p>{{ t("group.addFirstExpense") }}</p>
          </div>
          <template v-else>
            <template v-for="(e, i) in expenses" :key="e.id">
              <div
                v-if="i === 0 || expenses[i - 1]?.date !== e.date"
                class="date-label"
              >
                {{ dateLabel(e.date, t) }}
              </div>
              <div class="expense-row">
                <div class="expense-cat">{{ categoryIcon(e.category) }}</div>
                <div class="expense-mid">
                  <div class="desc">{{ expTitle(e) }}</div>
                  <div v-if="expSubtitle(e)" class="sub">
                    {{ expSubtitle(e) }}
                  </div>
                  <div class="sub">
                    {{ nameOf(e.paidBy, user) }} {{ t("group.paid") }}
                    {{ fmt(e.amountBase, group.baseCurrency)
                    }}<template
                      v-if="e.currency && e.currency !== group.baseCurrency"
                    >
                      ({{ e.currency }} {{ Math.round(e.amount * 100) / 100 }})</template
                    >
                  </div>
                </div>
                <div class="expense-right">
                  <div class="total"></div>
                  <div class="share">
                    <template
                      v-if="
                        Math.abs(
                          (e.paidBy === user.id ? e.amountBase : 0) -
                            ((e.splits || {})[user.id] || 0),
                        ) < 0.005
                      "
                    >
                      <span class="neu">{{ t("group.notInvolved") }}</span>
                    </template>
                    <template
                      v-else-if="
                        (e.paidBy === user.id ? e.amountBase : 0) -
                          ((e.splits || {})[user.id] || 0) >
                        0
                      "
                    >
                      <span class="pos"
                        >{{ user.name }} {{ t("group.lent") }}
                        {{
                          fmt(
                            (e.paidBy === user.id ? e.amountBase : 0) -
                              ((e.splits || {})[user.id] || 0),
                            group.baseCurrency,
                          )
                        }}</span
                      >
                    </template>
                    <template v-else>
                      <span class="neg"
                        >{{ user.name }} {{ t("group.owes") }}
                        {{
                          fmt(
                            -(
                              (e.paidBy === user.id ? e.amountBase : 0) -
                              ((e.splits || {})[user.id] || 0)
                            ),
                            group.baseCurrency,
                          )
                        }}</span
                      >
                    </template>
                  </div>
                  <button
                    v-if="e.createdBy === user.id || user.role === 'admin'"
                    class="expense-edit"
                    @click="openEditExpense(e)"
                  >
                    {{ t("group.edit") }}
                  </button>
                  <button
                    v-if="e.createdBy === user.id || user.role === 'admin'"
                    class="expense-del"
                    @click="delExpense(e.id)"
                  >
                    {{ confirmDelete === "e:" + e.id ? t("group.confirmDelete") : t("group.delete") }}
                  </button>
                </div>
              </div>
            </template>
          </template>
        </div>

        <!-- Balances tab -->
        <div v-if="tab === 'balances'">
          <div class="section-label">{{ t("group.netBalance") }}</div>
          <div
            v-for="id in group.memberIds"
            :key="id"
            class="balance-row"
          >
            <span class="name">{{ nameOf(id, user) }}</span>
            <span
              style="
                font-size: 12px;
                color: var(--ink-faint);
                margin-right: 8px;
              "
            >
              {{
                Math.abs(balanceOf(id)) < 0.005
                  ? t("group.settledUp")
                  : balanceOf(id) > 0
                    ? t("group.isOwed")
                    : t("group.owes")
              }}
            </span>
            <span
              class="amt"
              :class="
                Math.abs(balanceOf(id)) < 0.005
                  ? 'neu'
                  : balanceOf(id) > 0
                    ? 'pos'
                    : 'neg'
              "
            >
              {{ fmt(Math.abs(balanceOf(id)), group.baseCurrency) }}
            </span>
          </div>
          <div class="section-label" style="margin-top: 22px">
            {{ t("group.suggestedSettlements") }}
          </div>
          <div
            v-if="!transfers.length"
            class="empty"
            style="padding: 30px 10px"
          >
            <span class="icon">✅</span>
            <p>{{ t("group.everyoneSettled") }}</p>
          </div>
          <div v-else>
            <div
              v-for="(t2, i) in transfers"
              :key="i"
              class="settle-suggest"
            >
              <div class="txt">
                <!--
                  i18n-t keeps each locale's word order while letting the names
                  render as components. Slots are interpolated as text nodes,
                  never as HTML, so a display name can't inject markup.
                -->
                <i18n-t keypath="group.settleSuggestion" tag="span">
                  <template #from><b>{{ nameOf(t2.from, user) }}</b></template>
                  <template #to><b>{{ nameOf(t2.to, user) }}</b></template>
                  <template #amount>
                    {{ fmt(t2.amount, group.baseCurrency) }}
                  </template>
                </i18n-t>
              </div>
              <button
                class="btn btn-sm btn-accent"
                @click="quickSettle(t2.from, t2.to)"
              >
                {{ t("group.markPaid") }}
              </button>
            </div>
          </div>
        </div>

        <!-- Activity tab -->
        <div v-if="tab === 'activity'">
          <div v-if="!activity.length" class="empty">
            <span class="icon">📜</span>
            <h3>{{ t("group.noActivity") }}</h3>
          </div>
          <div v-else>
            <div
              v-for="(it, i) in activity"
              :key="i"
              class="activity-row"
            >
              <div class="dot"></div>
              <div class="body">
                <template v-if="it.type === 'expense'">
                  <b>{{ nameOf((it.data as never as { createdBy: string }).createdBy, user) }}</b>
                  {{ t("group.added") }} "{{
                    expTitle(it.data as never as Expense)
                  }}" —
                  {{
                    fmt(
                      (it.data as never as { amountBase: number }).amountBase,
                      group.baseCurrency,
                    )
                  }}, {{ t("group.paidBy") }}
                  {{
                    nameOf(
                      (it.data as never as { paidBy: string }).paidBy,
                      user,
                    )
                  }}
                  <div class="when">
                    {{ timeAgo((it.data as never as { createdAt: number }).createdAt || 0, t) }}
                  </div>
                </template>
                <template v-else>
                  <b>{{ nameOf((it.data as never as { from: string }).from, user) }}</b>
                  {{ t("group.paid") }}
                  <b>{{ nameOf((it.data as never as { to: string }).to, user) }}</b>
                  {{
                    fmt(
                      (it.data as never as { amount: number }).amount,
                      group.baseCurrency,
                    )
                  }}
                  <template v-if="(it.data as never as { note?: string }).note">
                    — {{ (it.data as never as { note?: string }).note }}</template
                  >
                  <div class="when">
                    {{ timeAgo((it.data as never as { createdAt: number }).createdAt || 0, t) }}
                    <template
                      v-if="
                        (it.data as never as { createdBy: string }).createdBy ===
                          user.id ||
                        user.role === 'admin'
                      "
                    >
                      ·
                      <a
                        style="color: var(--negative); cursor: pointer"
                        @click="
                          delSettlement((it.data as never as { id: string }).id)
                        "
                        >{{
                          confirmDelete ===
                          "s:" + (it.data as never as { id: string }).id
                            ? t("group.confirmDeleteLink")
                            : t("group.delete")
                        }}</a
                      >
                    </template>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Recurring tab -->
        <div v-if="tab === 'recurring'">
          <div style="margin-bottom: 14px">
            <button
              class="btn btn-sm btn-accent"
              @click="editingRecurring = null; showRecurringModal = true"
            >
              + {{ t("group.addRecurring") }}
            </button>
          </div>
          <div v-if="!recurring.length" class="empty">
            <span class="icon">🔁</span>
            <h3>{{ t("group.noRecurring") }}</h3>
            <p>{{ t("group.addRecurringHint") }}</p>
          </div>
          <div v-else>
            <div
              v-for="r in recurring"
              :key="r.id"
              class="balance-row"
            >
              <span class="name">
                {{ r.title }}
                <span style="font-size: 12px; color: var(--ink-faint)">
                  · {{ t(`expenseModal.recurrence_${r.recurrence}`) }} ·
                  {{ fmt(r.amountBase, group.baseCurrency) }}
                </span>
              </span>
              <span class="amt" style="font-size: 12.5px">{{ r.startDate }}</span>
              <button
                v-if="r.createdBy === user.id || user.role === 'admin'"
                class="btn btn-sm"
                @click="editRecurring(r)"
              >
                {{ t("group.edit") }}
              </button>
              <button
                v-if="r.createdBy === user.id || user.role === 'admin'"
                class="btn btn-sm btn-ghost"
                style="color: var(--negative)"
                @click="delRecurring(r.id)"
              >
                {{ t("group.delete") }}
              </button>
            </div>
          </div>
        </div>
      </template>
    </main>
    <div v-if="group" class="fab-bar">
      <div class="inner">
        <button class="fab" @click="openSettle">{{ t("group.settleUp") }}</button>
        <button class="fab primary" @click="openNewExpense">
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
      @saved="
        showRecurringModal = false;
        editingRecurring = null;
        loadRecurring();
      "
      @error="showToast($event)"
    />
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>
