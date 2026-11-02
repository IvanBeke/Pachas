<script setup lang="ts">
import { fmt, type Profile } from "~/utils/format";
import { useProfiles } from "~/composables/useGroups";
import type { Balance, SuggestedTransfer } from "~/composables/useGroupDetail";
import NetBalances from "~/components/group/NetBalances.vue";

const props = defineProps<{
  memberIds: string[];
  balances: Balance[];
  transfers: SuggestedTransfer[];
  me: Profile;
  baseCurrency: string;
  isElevated: boolean;
}>();
const emit = defineEmits<{ settle: [from: string, to: string] }>();

const { t } = useI18n();
const { nameOf } = useProfiles();

const visibleTransfers = computed(() =>
  props.isElevated
    ? props.transfers
    : props.transfers.filter((transfer) => transfer.from === props.me.id),
);
</script>

<template>
  <div>
    <NetBalances
      :member-ids="memberIds"
      :balances="balances"
      :me="me"
      :base-currency="baseCurrency"
    />
    <div class="section-label" style="margin-top: 22px">
      {{ t("group.suggestedSettlements") }}
    </div>
    <div v-if="!visibleTransfers.length" class="empty" style="padding: 30px 10px">
      <span class="icon">✅</span>
      <p>{{ t(isElevated ? "group.everyoneSettled" : "group.noDebtsToSettle") }}</p>
    </div>
    <div v-else>
      <div
        v-for="tr in visibleTransfers"
        :key="`${tr.from}:${tr.to}`"
        class="settle-suggest"
      >
        <div class="txt">
          <!--
            i18n-t keeps each locale's word order while letting the names
            render as components. Slots are interpolated as text nodes,
            never as HTML, so a display name can't inject markup.
          -->
          <i18n-t keypath="group.settleSuggestion" tag="span">
            <template #from><b>{{ nameOf(tr.from, me) }}</b></template>
            <template #to><b>{{ nameOf(tr.to, me) }}</b></template>
            <template #amount>{{ fmt(tr.amount, baseCurrency) }}</template>
          </i18n-t>
        </div>
        <button class="btn btn-sm btn-accent" @click="emit('settle', tr.from, tr.to)">
          {{ t("group.markPaid") }}
        </button>
      </div>
    </div>
  </div>
</template>
