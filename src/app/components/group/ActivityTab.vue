<script setup lang="ts">
import { fmt, timeAgo, type Expense, type Profile, type Settlement } from "~/utils/format";
import { useProfiles } from "~/composables/useGroups";

const props = defineProps<{
  expenses: Expense[];
  settlements: Settlement[];
  me: Profile;
  baseCurrency: string;
  confirmDelete: string | null;
}>();
const emit = defineEmits<{ deleteSettlement: [id: string] }>();

const { t } = useI18n();
const { nameOf } = useProfiles();

type Item =
  | { type: "expense"; ts: number; data: Expense }
  | { type: "settlement"; ts: number; data: Settlement };

const items = computed<Item[]>(() =>
  [
    ...props.expenses.map((data) => ({ type: "expense" as const, ts: data.createdAt || 0, data })),
    ...props.settlements.map((data) => ({
      type: "settlement" as const,
      ts: data.createdAt || 0,
      data,
    })),
  ].sort((a, b) => b.ts - a.ts),
);
</script>

<template>
  <div>
    <div v-if="!items.length" class="empty">
      <span class="icon">📜</span>
      <h3>{{ t("group.noActivity") }}</h3>
    </div>
    <div v-for="it in items" v-else :key="`${it.type}:${it.data.id}`" class="activity-row">
      <div class="dot"></div>
      <div class="body">
        <template v-if="it.type === 'expense'">
          <b>{{ nameOf(it.data.createdBy, me) }}</b>
          {{ t("group.added") }} "{{ it.data.title || it.data.description }}" —
          {{ fmt(it.data.amountBase, baseCurrency) }}, {{ t("group.paidBy") }}
          {{ nameOf(it.data.paidBy, me) }}
          <div class="when">{{ timeAgo(it.ts, t) }}</div>
        </template>
        <template v-else>
          <b>{{ nameOf(it.data.from, me) }}</b>
          {{ t("group.paid") }}
          <b>{{ nameOf(it.data.to, me) }}</b>
          {{ fmt(it.data.amount, baseCurrency) }}
          <template v-if="it.data.note"> — {{ it.data.note }}</template>
          <div class="when">
            {{ timeAgo(it.ts, t) }}
            <template v-if="it.data.createdBy === me.id">
              ·
              <a class="delete-link" @click="emit('deleteSettlement', it.data.id)">{{
                confirmDelete === "s:" + it.data.id
                  ? t("group.confirmDeleteLink")
                  : t("group.delete")
              }}</a>
            </template>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.delete-link {
  color: var(--negative);
  cursor: pointer;
}
</style>
