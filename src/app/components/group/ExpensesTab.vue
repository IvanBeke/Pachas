<script setup lang="ts">
import { dateLabel, fmt, parseItems, type Expense, type Profile } from "~/utils/format";
import { useProfiles } from "~/composables/useGroups";
import { round2 } from "~/utils/splits";

const props = defineProps<{
  expenses: Expense[];
  me: Profile;
  baseCurrency: string;
  canManageAll: boolean;
  confirmDelete: string | null;
}>();
const emit = defineEmits<{ edit: [expense: Expense]; delete: [id: string] }>();

const { t } = useI18n();
const { nameOf } = useProfiles();
const { iconOf } = useCategories();

// One-line summary for items-split expenses
// ("3 items · Ramen, Gyoza · +tax · +18% tip").
// Falls back to the raw description when it isn't an items payload.
function subtitleOf(e: Expense): string | null {
  if (e.splitType === "items") {
    const parsed = parseItems(e.description);
    if (!parsed) return e.description || null;
    const names = parsed.items
      .map((it) => it.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    let s =
      `${parsed.items.length} ${t("expenseModal.splitItems")}` + (names ? ` · ${names}` : "");
    if (parsed.tax > 0) s += " · +tax";
    if (parsed.tipPercent > 0) s += ` · +${parsed.tipPercent}% tip`;
    return s;
  }
  return e.title && e.description ? e.description : null;
}

/**
 * Everything the row template needs, derived once per data change instead of
 * on every render (items descriptions are JSON and were re-parsed each time).
 */
const rows = computed(() =>
  props.expenses.map((e, i) => {
    const net = round2((e.paidBy === props.me.id ? e.amountBase : 0) - (e.splits?.[props.me.id] ?? 0));
    return {
      e,
      showDate: i === 0 || props.expenses[i - 1]?.date !== e.date,
      title: e.title || e.description,
      subtitle: subtitleOf(e),
      net,
      canManage: e.createdBy === props.me.id || props.canManageAll,
    };
  }),
);
</script>

<template>
  <div>
    <div v-if="!expenses.length" class="empty">
      <span class="icon">🧾</span>
      <h3>{{ t("group.noExpenses") }}</h3>
      <p>{{ t("group.addFirstExpense") }}</p>
    </div>
    <template v-for="row in rows" v-else :key="row.e.id">
      <div v-if="row.showDate" class="date-label">
        {{ dateLabel(row.e.date, t) }}
      </div>
      <div class="expense-row">
        <div class="expense-cat">{{ iconOf(row.e.category) }}</div>
        <div class="expense-mid">
          <div class="desc">
            {{ row.title }}
            <span v-if="row.e.recurringId" :title="t('group.recurring')">🔁</span>
          </div>
          <div v-if="row.subtitle" class="sub">{{ row.subtitle }}</div>
          <div class="sub">
            {{ nameOf(row.e.paidBy, me) }} {{ t("group.paid") }}
            {{ fmt(row.e.amountBase, baseCurrency)
            }}<template v-if="row.e.currency && row.e.currency !== baseCurrency">
              ({{ row.e.currency }} {{ row.e.amount }})</template
            >
          </div>
        </div>
        <div class="expense-right">
          <div class="total"></div>
          <div class="share">
            <span v-if="row.net === 0" class="neu">{{ t("group.notInvolved") }}</span>
            <span v-else-if="row.net > 0" class="pos">
              {{ me.name }} {{ t("group.lent") }} {{ fmt(row.net, baseCurrency) }}
            </span>
            <span v-else class="neg">
              {{ me.name }} {{ t("group.owes") }} {{ fmt(-row.net, baseCurrency) }}
            </span>
          </div>
          <template v-if="row.canManage">
            <button class="expense-edit" @click="emit('edit', row.e)">
              {{ t("group.edit") }}
            </button>
            <button class="expense-del" @click="emit('delete', row.e.id)">
              {{ confirmDelete === "e:" + row.e.id ? t("group.confirmDelete") : t("group.delete") }}
            </button>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
