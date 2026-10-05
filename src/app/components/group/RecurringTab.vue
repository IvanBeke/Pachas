<script setup lang="ts">
import { fmt, type Profile, type RecurringExpense } from "~/utils/format";

defineProps<{
  recurring: RecurringExpense[];
  me: Profile;
  baseCurrency: string;
  canManageAll: boolean;
}>();
const emit = defineEmits<{
  add: [];
  edit: [item: RecurringExpense];
  delete: [id: string];
}>();

const { t } = useI18n();
</script>

<template>
  <div>
    <div style="margin-bottom: 14px">
      <button class="btn btn-sm btn-accent" @click="emit('add')">
        + {{ t("group.addRecurring") }}
      </button>
    </div>
    <div v-if="!recurring.length" class="empty">
      <span class="icon">🔁</span>
      <h3>{{ t("group.noRecurring") }}</h3>
      <p>{{ t("group.addRecurringHint") }}</p>
    </div>
    <div v-for="r in recurring" v-else :key="r.id" class="balance-row">
      <span class="name">
        {{ r.title }}
        <span class="recurring-meta">
          · {{ t(`expenseModal.recurrence_${r.recurrence}`) }} ·
          {{ fmt(r.amountBase, baseCurrency) }}
        </span>
      </span>
      <span class="amt" style="font-size: 12.5px">
        {{ r.startDate }} – {{ r.endDate || t("recurringModal.noEndDate") }}
      </span>
      <template v-if="r.createdBy === me.id || canManageAll">
        <button class="btn btn-sm" @click="emit('edit', r)">
          {{ t("group.edit") }}
        </button>
        <button
          class="btn btn-sm btn-ghost"
          style="color: var(--negative)"
          @click="emit('delete', r.id)"
        >
          {{ t("group.delete") }}
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.recurring-meta {
  font-size: 12px;
  color: var(--ink-faint);
}
</style>
