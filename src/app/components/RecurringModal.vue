<script setup lang="ts">
import {
  CURRENCIES,
  fmt,
  todayStr,
  translatedTitle,
  type Category,
  type Group,
  type Profile,
  type RecurringExpense,
} from "~/utils/format";
import { useProfiles } from "~/composables/useGroups";
import {
  computeSplits,
  splitsToInputValues,
  type SplitType,
} from "~/utils/splits";

const { t, locale } = useI18n();

const props = defineProps<{
  group: Group;
  me: Profile;
  initial: RecurringExpense | null;
}>();
const emit = defineEmits<{ close: []; saved: []; error: [msg: string] }>();

const { nameOf } = useProfiles();

const title = ref(props.initial?.title ?? "");
const amount = ref(props.initial ? String(props.initial.amount) : "");
const currency = ref(props.initial?.currency ?? props.group.baseCurrency);
const exchangeRate = ref(props.initial?.exchangeRate ?? 1);
const paidBy = ref(props.initial?.paidBy ?? props.me.id);
const category = ref(props.initial?.category ?? "general");
const startDate = ref(props.initial?.startDate ?? todayStr());
const endDate = ref(props.initial?.endDate ?? "");
const showCur = ref(false);
const recurrence = ref<"week" | "month" | "year">(
  props.initial?.recurrence ?? "month",
);
const splitType = ref<SplitType>(
  (props.initial?.splitType as SplitType) ?? "equal",
);
const participants = ref<string[]>(
  props.initial
    ? Object.keys(props.initial.splits)
    : [...(props.group.memberIds || [])],
);
const splitValues = ref<Record<string, number>>(
  props.initial
    ? splitsToInputValues(
        props.initial.splits,
        props.initial.amountBase,
        splitType.value,
      )
    : {},
);

const categories = ref<Category[]>([]);
onMounted(async () => {
  try {
    categories.value = await $fetch<Category[]>("/api/categories");
  } catch {
    // keep fallback icons
  }
});

const memberIds = computed(() => props.group.memberIds || []);
const showRate = computed(() => currency.value !== props.group.baseCurrency);
const amountNum = computed(() => parseFloat(amount.value) || 0);

function isChecked(id: string): boolean {
  return participants.value.includes(id);
}

function toggleParticipant(id: string) {
  const i = participants.value.indexOf(id);
  if (i >= 0) participants.value.splice(i, 1);
  else participants.value.push(id);
}

function splitDefault(id: string): number {
  const n = participants.value.length || 1;
  const amt = amountNum.value;
  if (splitType.value === "exact")
    return isChecked(id) ? Math.round((amt / n) * 100) / 100 : 0;
  if (splitType.value === "percent")
    return isChecked(id) ? Math.round((100 / n) * 100) / 100 : 0;
  return isChecked(id) ? 1 : 0;
}

function setSplitType(s: typeof splitType.value) {
  splitType.value = s;
  const next: Record<string, number> = {};
  memberIds.value.forEach((id) => {
    if (isChecked(id)) next[id] = splitDefault(id);
  });
  splitValues.value = next;
}

function equalShare(id: string): string {
  if (!isChecked(id)) return "—";
  return fmt(amountNum.value / (participants.value.length || 1), currency.value);
}

const remainText = computed(() => {
  if (splitType.value === "equal") return "";
  const amountValue = amountNum.value;
  let sum = 0;
  memberIds.value.forEach((id) => {
    if (isChecked(id)) {
      sum += Number(splitValues.value[id] ?? splitDefault(id)) || 0;
    }
  });
  if (splitType.value === "exact") {
    const remaining = Math.round((amountValue - sum) * 100) / 100;
    if (Math.abs(remaining) < 0.005) return t("expenseModal.splitsMatch");
    return (
      fmt(Math.abs(remaining), currency.value) +
      (remaining > 0
        ? " " + t("expenseModal.leftToAssign")
        : " " + t("expenseModal.tooMuch"))
    );
  }
  if (splitType.value === "percent") {
    const remaining = Math.round((100 - sum) * 100) / 100;
    if (Math.abs(remaining) < 0.005) return t("expenseModal.hundredPercent");
    return (
      Math.abs(remaining) +
      "% " +
      (remaining > 0
        ? t("expenseModal.leftToAssign")
        : t("expenseModal.tooMuch"))
    );
  }
  return sum + " " + t("expenseModal.totalShare", sum);
});

const remainOk = computed(() => {
  if (splitType.value === "equal") return true;
  if (splitType.value === "exact") {
    let sum = 0;
    memberIds.value.forEach((id) => {
      if (isChecked(id)) {
        sum += Number(splitValues.value[id] ?? splitDefault(id)) || 0;
      }
    });
    return Math.abs(amountNum.value - sum) < 0.005;
  }
  if (splitType.value === "percent") {
    let sum = 0;
    memberIds.value.forEach((id) => {
      if (isChecked(id)) {
        sum += Number(splitValues.value[id] ?? splitDefault(id)) || 0;
      }
    });
    return Math.abs(100 - sum) < 0.005;
  }
  return true;
});

async function submit() {
  if (!startDate.value || (endDate.value && endDate.value < startDate.value)) {
    emit("error", t("recurringModal.invalidDateRange"));
    return;
  }
  const amt = parseFloat(amount.value);
  if (!title.value.trim() || !amt || amt <= 0 || !participants.value.length) {
    emit("error", t("expenseModal.errorTitleAmount"));
    return;
  }
  const rate =
    currency.value === props.group.baseCurrency
      ? 1
      : Number(exchangeRate.value) || 1;
  const amountBase = Math.round(amt * rate * 100) / 100;
  // Defaults mirror what the inputs show, so a missing value behaves the same
  // here as it does on screen.
  const values: Record<string, number> = {};
  participants.value.forEach((id) => {
    values[id] = splitValues.value[id] ?? splitDefault(id);
  });
  // Preview only — the server recomputes and is authoritative.
  const result = computeSplits({
    splitType: splitType.value,
    amountBase,
    rate,
    participants: participants.value,
    memberIds: memberIds.value,
    values,
  });
  if (!result.ok) {
    if (result.reason === "exact_mismatch") {
      emit("error", t("expenseModal.errorExact"));
    } else if (result.reason === "percent_mismatch") {
      emit("error", t("expenseModal.errorPercent"));
    } else {
      emit("error", t("expenseModal.errorShare"));
    }
    return;
  }
  try {
    // Send the SELECTION, not the computed amounts. See AGENTS.md.
    const payload = {
      title: title.value.trim(),
      description: "",
      amount: amt,
      currency: currency.value,
      exchangeRate: rate,
      amountBase,
      paidBy: paidBy.value,
      category: category.value,
      splitType: splitType.value,
      participants: [...participants.value],
      values,
      recurrence: recurrence.value,
      startDate: startDate.value,
      endDate: endDate.value || null,
    };
    if (props.initial) {
      await $fetch(
        `/api/groups/${props.group.id}/recurring/${props.initial.id}`,
        { method: "PATCH", body: payload },
      );
    } else {
      await $fetch(`/api/groups/${props.group.id}/recurring`, {
        method: "POST",
        body: payload,
      });
    }
    emit("saved");
  } catch (e: unknown) {
    emit("error", (e as Error)?.message || t("expenseModal.couldntSave"));
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet-wrap" style="position: relative">
      <div class="sheet">
        <button class="close-x" @click="emit('close')">✕</button>
        <h2>
          {{
            initial
              ? t("recurringModal.editTitle")
              : t("recurringModal.addTitle")
          }}
        </h2>
        <input
          v-model="title"
          type="text"
          class="hero-input"
          :placeholder="t('expenseModal.titlePlaceholder')"
        />
        <div class="hero-amount">
          <button
            class="hero-cur"
            type="button"
            @click="showCur = !showCur"
          >
            {{ currency }} ▾
          </button>
          <input
            v-model="amount"
            type="number"
            step="0.01"
            min="0"
            class="hero-num"
            placeholder="0.00"
          />
        </div>
        <div v-if="showCur" class="cur-list">
          <button
            v-for="c in CURRENCIES"
            :key="c"
            class="cur-item"
            type="button"
            @click="currency = c; showCur = false"
          >
            {{ c }}
          </button>
        </div>
        <div class="row2">
          <div class="field">
            <label>{{ t("expenseModal.paidBy") }}</label>
            <select v-model="paidBy">
              <option v-for="id in memberIds" :key="id" :value="id">
                {{ nameOf(id, me) }}
              </option>
            </select>
          </div>
          <div class="field">
            <label>{{ t("expenseModal.category") }}</label>
            <select v-model="category">
              <option v-for="c in categories" :key="c.id" :value="c.id">
                {{ c.icon }} {{ translatedTitle(c, locale) }}
              </option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>{{ t("expenseModal.recurrence") }}</label>
          <div class="segmented">
            <button
              v-for="r in ['week', 'month', 'year']"
              :key="r"
              :class="{ active: recurrence === r }"
              @click="recurrence = r"
            >
              {{ t(`expenseModal.recurrence_${r}`) }}
            </button>
          </div>
        </div>
        <div class="field">
          <label>{{ t("expenseModal.startDate") }}</label>
          <input v-model="startDate" type="date" required />
        </div>
        <div class="field">
          <label>{{ t("expenseModal.endDate") }}</label>
          <input v-model="endDate" type="date" :min="startDate" />
        </div>
        <div v-if="showRate" class="field">
          <label>
            {{
              t("expenseModal.exchangeRate", {
                currency,
                base: group.baseCurrency,
              })
            }}
          </label>
          <input
            v-model.number="exchangeRate"
            type="number"
            step="0.0001"
            min="0"
          />
        </div>
        <div class="field">
          <label>{{ t("expenseModal.split") }}</label>
          <div class="segmented split-mode-toggle">
            <button
              v-for="s in ['equal', 'exact', 'percent', 'shares']"
              :key="s"
              :class="{ active: splitType === s }"
              @click="setSplitType(s)"
            >
              {{ t(`expenseModal.split${s.charAt(0).toUpperCase() + s.slice(1)}`) }}
            </button>
          </div>
          <div>
            <div v-for="id in memberIds" :key="id" class="split-row">
              <input
                type="checkbox"
                :checked="isChecked(id)"
                @change="toggleParticipant(id)"
              />
              <span class="nm">{{ nameOf(id, me) }}</span>
              <span v-if="splitType === 'equal'" class="split-share-value">
                {{ equalShare(id) }}
              </span>
              <input
                v-else
                v-model.number="splitValues[id]"
                type="number"
                :step="splitType === 'shares' ? 1 : 0.01"
                min="0"
                :disabled="!isChecked(id)"
              />
            </div>
          </div>
          <div
            v-if="splitType !== 'equal'"
            class="split-remain"
            :class="remainOk ? 'ok' : 'bad'"
          >
            {{ remainText }}
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-block btn-accent" @click="submit">
            {{ t("expenseModal.save") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hero-input {
  width: 100%;
  padding: 14px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--line-strong);
  background: var(--bg);
  color: var(--ink);
  font-size: 18px;
  font-family: var(--sans);
}
.hero-input::placeholder {
  color: var(--ink-faint);
}
.hero-amount {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 12px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--line-strong);
  background: var(--bg);
}
.hero-amount:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.hero-cur {
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  border: 1px solid var(--line-strong);
  background: var(--bg-sunken);
  border-radius: 999px;
  padding: 6px 12px;
  cursor: pointer;
  font-family: var(--sans);
  white-space: nowrap;
}
.hero-cur:active {
  transform: scale(0.97);
}
.cur-list {
  margin-top: 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  overflow: hidden;
  max-height: 180px;
  overflow-y: auto;
  position: absolute;
  left: 20px;
  right: 20px;
  z-index: 30;
  background: var(--bg-elevated);
}
.cur-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 10px 12px;
  font-size: 14px;
  color: var(--ink);
  cursor: pointer;
  font-family: var(--sans);
}
.cur-item:hover,
.cur-item:active {
  background: var(--bg-sunken);
}
.hero-num {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  color: var(--ink);
  font-size: 26px;
  font-weight: 700;
  font-family: var(--sans);
  font-variant-numeric: tabular-nums;
}
.hero-num:focus {
  outline: none;
}
.hero-num::placeholder {
  color: var(--line-strong);
}
</style>
