<script setup lang="ts">
import { fmt, type Profile } from "~/utils/format";
import { useProfiles } from "~/composables/useGroups";
import type { Balance } from "~/composables/useGroupDetail";

const props = defineProps<{
  memberIds: string[];
  balances: Balance[];
  me: Profile;
  baseCurrency: string;
  /** Name on one line and "owes 3,78 €" below it, for narrow columns. */
  stacked?: boolean;
}>();

const { t } = useI18n();
const { nameOf } = useProfiles();

const STATE_LABELS = {
  neu: "group.settledUp",
  pos: "group.isOwed",
  neg: "group.owes",
} as const;

const rows = computed(() => {
  const byId = new Map(props.balances.map((b) => [b.memberId, b.amount]));
  return props.memberIds.map((id) => {
    const amount = byId.get(id) ?? 0;
    const state = amount === 0 ? "neu" : amount > 0 ? "pos" : "neg";
    return { id, amount, state, label: t(STATE_LABELS[state]) };
  });
});
</script>

<template>
  <div :class="{ stacked }">
    <div class="section-label">{{ t("group.netBalance") }}</div>
    <div v-for="row in rows" :key="row.id" class="balance-row">
      <span class="name">{{ nameOf(row.id, me) }}</span>
      <span>
        <span class="balance-state">{{ row.label }}</span> <span class="amt" :class="row.state">{{ fmt(Math.abs(row.amount), baseCurrency) }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.balance-state {
  font-size: 12px;
  color: var(--ink-faint);
}
.stacked .balance-row {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.stacked .balance-row .name {
  flex: none;
}
/* In the narrow column the amount is the same size as the status text beside it. */
.stacked .amt {
  font-size: 12px;
}
</style>
