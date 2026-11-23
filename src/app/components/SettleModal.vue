<script setup lang="ts">
import { fmt, type Group, type Profile } from "~/utils/format";
import { useProfiles } from "~/composables/useGroups";
import type { Balance, SuggestedTransfer } from "~/composables/useGroupDetail";
import {
  balancesAfter,
  canRecordPayment,
  payerOptions,
  receiverOptions,
  transferKey,
  visibleTransfers,
} from "~/utils/settle";
import { GroupRole } from "../../shared/group-roles";
import { fromCents, toCents } from "../../shared/money";
import { maxPaymentCents } from "../../shared/payment-rules";

const { t } = useI18n();

const props = defineProps<{
  group: Group;
  me: Profile;
  preset?: { from: string; to: string };
  /** The server's suggested payments, each with its outstanding amount. */
  transfers: SuggestedTransfer[];
  /** Net balance of every member; a payment can't exceed what the receiver is owed. */
  balances: Balance[];
}>();
const emit = defineEmits<{ close: []; saved: []; error: [msg: string] }>();

const { nameOf } = useProfiles();
const role = computed(
  () => props.group.members.find((member) => member.userId === props.me.id)?.role,
);
const isGroupElevated = computed(
  () => role.value === GroupRole.Creator || role.value === GroupRole.Admin,
);
const rows = computed(() =>
  visibleTransfers(props.transfers, props.me.id, isGroupElevated.value),
);

// The selected option is a suggested payment (its pair key) or "Another payment".
const OTHER = "other";
const selected = ref<string | null>(
  props.preset && rows.value.some((row) => transferKey(row) === transferKey(props.preset!))
    ? transferKey(props.preset)
    : null,
);
const note = ref("");
// A number input's v-model yields a number (or "" when empty), not a string.
const amount = ref<number | string>("");
const from = ref("");
const to = ref("");

// The group refreshes while the modal is open: if the chosen payment is gone
// (someone else settled it), the choice is dropped instead of silently failing.
const current = computed(() => rows.value.find((row) => transferKey(row) === selected.value));
watch(rows, () => {
  if (!rows.value.length || (selected.value !== OTHER && !current.value)) selected.value = null;
});

function select(key: string) {
  selected.value = key;
  amount.value = "";
}

const context = computed(() => ({
  memberIds: props.group.memberIds,
  balances: props.balances,
  transfers: props.transfers,
  meId: props.me.id,
  isElevated: isGroupElevated.value,
}));
const fromOptions = computed(() => payerOptions(context.value));
const toOptions = computed(() => receiverOptions(context.value, from.value));
// Keep each pick valid when the balances or the other pick change.
watch(
  fromOptions,
  (options) => {
    if (!options.includes(from.value)) from.value = options[0] ?? "";
  },
  { immediate: true },
);
watch(
  toOptions,
  (options) => {
    if (!options.includes(to.value)) to.value = options[0] ?? "";
  },
  { immediate: true },
);

// A suggested payment settles its whole debt; "Another payment" has its own pair and amount.
const pair = computed(() =>
  selected.value === OTHER
    ? { from: from.value, to: to.value }
    : current.value
      ? { from: current.value.from, to: current.value.to }
      : null,
);
const amountValue = computed(() => Number(amount.value));
const maxCents = computed(() =>
  pair.value
    ? maxPaymentCents(props.balances, props.transfers, pair.value.from, pair.value.to)
    : 0,
);
const amountValid = computed(
  () =>
    String(amount.value).trim() !== "" &&
    toCents(amountValue.value) > 0 &&
    toCents(amountValue.value) <= maxCents.value,
);
const canSubmit = computed(
  () =>
    !!pair.value?.from &&
    !!pair.value.to &&
    (selected.value !== OTHER || amountValid.value) &&
    canRecordPayment(pair.value.from, pair.value.to, props.me.id, isGroupElevated.value),
);
// The payer's and receiver's real balances once this amount is recorded.
const preview = computed(() =>
  selected.value === OTHER && pair.value && amountValid.value
    ? balancesAfter(props.balances, pair.value.from, pair.value.to, amountValue.value)
    : [],
);

/** The server allocates the payment against the debts; without an amount it settles the whole suggested debt. */
async function submit() {
  if (!pair.value || !canSubmit.value) return;
  try {
    await $fetch(`/api/groups/${props.group.id}/settlements`, {
      method: "POST",
      body: {
        from: pair.value.from,
        to: pair.value.to,
        ...(selected.value === OTHER ? { amount: amountValue.value } : {}),
        note: note.value.trim(),
      },
    });
    emit("saved");
  } catch (e: unknown) {
    emit("error", (e as Error)?.message || t("settleModal.couldntRecord"));
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet-wrap sheet-wrap-md">
      <div class="sheet">
        <button class="close-x" @click="emit('close')">✕</button>
        <h2>{{ t("settleModal.title") }}</h2>
        <div v-if="!rows.length" class="empty" style="padding: 20px 10px">
          <span class="icon">✅</span>
          <p>{{ t(isGroupElevated ? "group.everyoneSettled" : "group.noDebtsToSettle") }}</p>
        </div>
        <div v-else class="field">
          <label id="settle-pick">{{ t("settleModal.pick") }}</label>
          <div role="radiogroup" aria-labelledby="settle-pick">
            <button
              v-for="row in rows"
              :key="transferKey(row)"
              type="button"
              role="radio"
              class="settle-option"
              :class="{ selected: transferKey(row) === selected }"
              :aria-checked="transferKey(row) === selected"
              @click="select(transferKey(row))"
            >
              <span class="dot" aria-hidden="true" />
              <span class="txt">
                <i18n-t keypath="group.settleSuggestion" tag="span">
                  <template #from><b>{{ nameOf(row.from, me) }}</b></template>
                  <template #to><b>{{ nameOf(row.to, me) }}</b></template>
                  <template #amount><b>{{ fmt(row.amount, group.baseCurrency) }}</b></template>
                </i18n-t>
              </span>
            </button>
            <button
              type="button"
              role="radio"
              class="settle-option"
              :class="{ selected: selected === OTHER }"
              :aria-checked="selected === OTHER"
              @click="select(OTHER)"
            >
              <span class="dot" aria-hidden="true" />
              <span class="txt">{{ t("settleModal.other") }}</span>
            </button>
          </div>
        </div>
        <template v-if="selected">
          <template v-if="selected === OTHER">
            <div class="row2">
              <div class="field">
                <label for="settle-from">{{ t("settleModal.from") }}</label>
                <select id="settle-from" v-model="from">
                  <option v-for="id in fromOptions" :key="id" :value="id">
                    {{ nameOf(id, me) }}
                  </option>
                </select>
              </div>
              <div class="field">
                <label for="settle-to">{{ t("settleModal.to") }}</label>
                <select id="settle-to" v-model="to">
                  <option v-for="id in toOptions" :key="id" :value="id">
                    {{ nameOf(id, me) }}
                  </option>
                </select>
              </div>
            </div>
            <p v-if="!fromOptions.length || !toOptions.length" class="settle-note">
              {{ t("settleModal.noPayment") }}
            </p>
            <div class="field">
              <label for="settle-amount">
                {{ t("settleModal.amount", { currency: group.baseCurrency }) }}
              </label>
              <input
                id="settle-amount"
                v-model="amount"
                type="number"
                step="0.01"
                min="0"
                :max="fromCents(maxCents)"
                inputmode="decimal"
              />
              <p v-if="pair?.to" class="settle-note">
                {{ t("settleModal.max", { amount: fmt(fromCents(maxCents), group.baseCurrency) }) }}
              </p>
              <div v-if="preview.length">
                <div class="settle-note">{{ t("settleModal.after") }}</div>
                <div v-for="row in preview" :key="row.id" class="settle-note">
                  <b>{{ nameOf(row.id, me) }}</b>:
                  {{ fmt(row.before, group.baseCurrency) }} → {{ fmt(row.after, group.baseCurrency) }}
                </div>
              </div>
            </div>
          </template>
          <div class="field">
            <label>{{ t("settleModal.note") }}</label>
            <input
              v-model="note"
              type="text"
              :placeholder="t('settleModal.notePlaceholder')"
            />
          </div>
          <div class="modal-actions">
            <button class="btn btn-block btn-accent" :disabled="!canSubmit" @click="submit">
              {{ t("settleModal.record") }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settle-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  font: inherit;
  color: var(--ink);
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 12px 14px;
  margin-bottom: 8px;
  cursor: pointer;
}
.settle-option .txt {
  flex: 1;
  font-size: 14px;
  line-height: 1.4;
}
.settle-option .txt b {
  font-weight: 700;
}
.settle-option .dot {
  flex: 0 0 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--line-strong);
}
.settle-option.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.settle-option.selected .dot {
  border-color: var(--accent);
  background: radial-gradient(circle, var(--accent) 0 45%, transparent 50%);
}
.settle-option:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.settle-note {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--ink-soft, var(--ink));
}
</style>
