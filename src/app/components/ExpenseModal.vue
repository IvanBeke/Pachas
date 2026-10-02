<script setup lang="ts">
import {
  CURRENCIES,
  fmt,
  todayStr,
  translatedTitle,
  type Category,
  type ItemsData,
  type Group,
  type Profile,
} from "~/utils/format";
import { useProfiles } from "~/composables/useGroups";
import { computeSplits, itemsTotals, splitsToInputValues } from "~/utils/splits";
import ItemsModal from "~/components/ItemsModal.vue";

const { t, locale } = useI18n();

const props = defineProps<{
  group: Group;
  me: Profile;
  initial?: {
    id: string;
    title: string;
    description: string;
    amount: number;
    currency: string;
    exchangeRate: number;
    amountBase: number;
    paidBy: string;
    category: string;
    date: string;
    splitType: string;
    splits: Record<string, number>;
  } | null;
}>();
const emit = defineEmits<{ close: []; saved: []; error: [msg: string] }>();

onMounted(async () => {
  try {
    categories.value = await $fetch<Category[]>("/api/categories");
  } catch {
  }
});

const { nameOf } = useProfiles();

const title = ref("");
const description = ref("");
const amount = ref("");
const currency = ref(props.group.baseCurrency);
const exchangeRate = ref(1);
const paidBy = ref(props.me.id);
const category = ref("general");
const date = ref(todayStr());

const categories = ref<Category[]>([]);
const categoryIcon = (id: string): string =>
  categories.value.find((c) => String(c.id) === id)?.icon ?? "🧾";

const splitType = ref<"equal" | "exact" | "percent" | "shares" | "items">("equal");
const isRecurring = ref(false);
const recurrence = ref<"week" | "month" | "year">("month");
const startDate = ref(todayStr());
const participants = ref<string[]>([...(props.group.memberIds || [])]);
const splitValues = ref<Record<string, number>>({});
const items = ref<ItemsData>({ items: [], tax: 0, tipPercent: 0 });
const showItems = ref(false);
const showCur = ref(false);

watch(
  () => props.initial,
  (val) => {
    if (!val) return;
    title.value = val.title;
    description.value = val.description;
    amount.value = String(val.amount);
    currency.value = val.currency;
    exchangeRate.value = val.exchangeRate;
    paidBy.value = val.paidBy;
    category.value = val.category;
    date.value = val.date;
    splitType.value = val.splitType as
      | "equal"
      | "exact"
      | "percent"
      | "shares"
      | "items";
    participants.value = Object.keys(val.splits);
    splitValues.value = splitsToInputValues(
      val.splits,
      val.amountBase,
      splitType.value,
    );
    if (splitType.value === "items") {
      try {
        const parsed = JSON.parse(val.description) as ItemsData;
        if (parsed && Array.isArray(parsed.items)) items.value = parsed;
      } catch {
      }
    }
  },
  { immediate: true },
);

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

function splitVal(id: string): number {
  return splitValues.value[id] ?? 0;
}

function equalShare(id: string): string {
  if (!isChecked(id)) return "—";
  const n = participants.value.length || 1;
  return fmt(amountNum.value / n, currency.value);
}

const remainText = computed(() => {
  if (splitType.value === "equal") return "";
  const amt = amountNum.value;
  let sum = 0;
  memberIds.value.forEach((id) => {
    if (isChecked(id)) sum += Number(splitValues.value[id] ?? splitDefault(id)) || 0;
  });
  if (splitType.value === "exact") {
    const rem = Math.round((amt - sum) * 100) / 100;
    if (Math.abs(rem) < 0.005) return t("expenseModal.splitsMatch");
    return (
      fmt(Math.abs(rem), currency.value) +
      (rem > 0 ? " " + t("expenseModal.leftToAssign") : " " + t("expenseModal.tooMuch"))
    );
  }
  if (splitType.value === "percent") {
    const remP = Math.round((100 - sum) * 100) / 100;
    if (Math.abs(remP) < 0.005) return t("expenseModal.hundredPercent");
    return (
      Math.abs(remP) + "% " + (remP > 0 ? t("expenseModal.leftToAssign") : t("expenseModal.tooMuch"))
    );
  }
  return sum + " " + t("expenseModal.totalShare", sum);
});

const remainOk = computed(() => {
  if (splitType.value === "equal") return true;
  if (splitType.value === "exact") {
    let sum = 0;
    memberIds.value.forEach((id) => {
      if (isChecked(id))
        sum += Number(splitValues.value[id] ?? splitDefault(id)) || 0;
    });
    return Math.abs(amountNum.value - sum) < 0.005;
  }
  if (splitType.value === "percent") {
    let sum = 0;
    memberIds.value.forEach((id) => {
      if (isChecked(id))
        sum += Number(splitValues.value[id] ?? splitDefault(id)) || 0;
    });
    return Math.abs(100 - sum) < 0.005;
  }
  return true;
});

function setSplitType(s: typeof splitType.value) {
  splitType.value = s;
  const next: Record<string, number> = {};
  memberIds.value.forEach((id) => {
    if (isChecked(id)) next[id] = splitDefault(id);
  });
  splitValues.value = next;
  if (s === "items" && !items.value.items.length) showItems.value = true;
}

const itemsGrandPerPerson = computed(() =>
  itemsTotals(items.value.items, memberIds.value),
);
const itemsTotal = computed(() =>
  Math.round(
    memberIds.value.reduce(
      (s, id) => s + (itemsGrandPerPerson.value[id] || 0),
      0,
    ) * 100,
  ) / 100,
);

async function submit() {
  const inItemsMode = splitType.value === "items";
  const amt = inItemsMode ? itemsTotal.value : parseFloat(amount.value);
  if (
    !title.value.trim() ||
    !amt ||
    amt <= 0 ||
    !participants.value.length
  ) {
    emit("error", t("expenseModal.errorTitleAmount"));
    return;
  }
  if (inItemsMode && !items.value.items.length) {
    emit("error", t("expenseModal.errorItem"));
    return;
  }
  const rate =
    currency.value === props.group.baseCurrency
      ? 1
      : Number(exchangeRate.value) || 1;
  const amountBase = Math.round(amt * rate * 100) / 100;
  const values: Record<string, number> = {};
  participants.value.forEach((id) => {
    values[id] = splitValues.value[id] ?? splitDefault(id);
  });
  const result = computeSplits({
    splitType: splitType.value,
    amountBase,
    rate,
    participants: participants.value,
    memberIds: memberIds.value,
    values,
    items: items.value.items,
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
    const payload = {
      title: title.value.trim(),
      description:
        splitType.value === "items"
          ? JSON.stringify(items.value)
          : description.value.trim(),
      amount: amt,
      currency: currency.value,
      exchangeRate: rate,
      amountBase,
      paidBy: paidBy.value,
      category: category.value,
      date: date.value,
      splitType: splitType.value,
      participants: [...participants.value],
      values,
      items: items.value.items,
    };
    if (props.initial) {
      await $fetch(`/api/groups/${props.group.id}/expenses/${props.initial.id}`, {
        method: "PATCH",
        body: payload,
      });
    } else if (isRecurring.value) {
      await $fetch(`/api/groups/${props.group.id}/recurring`, {
        method: "POST",
        body: { ...payload, recurrence: recurrence.value, startDate: startDate.value },
      });
    } else {
      await $fetch(`/api/groups/${props.group.id}/expenses`, {
        method: "POST",
        body: payload,
      });
    }
    emit("saved");
  } catch (e: unknown) {
    emit("error", (e as Error)?.message || t("expenseModal.couldntSave"));
  }
}

const splitTypes = [
  { value: "equal", label: "expenseModal.splitEqual" },
  { value: "exact", label: "expenseModal.splitExact" },
  { value: "percent", label: "expenseModal.splitPercent" },
  { value: "shares", label: "expenseModal.splitShares" },
  { value: "items", label: "expenseModal.splitItems" },
] as const;
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet-wrap" style="position: relative">
      <div class="sheet">
        <button class="close-x" @click="emit('close')">✕</button>
        <h2>{{ props.initial ? t("expenseModal.editTitle") : t("expenseModal.title") }}</h2>
        <input
          v-model="title"
          type="text"
          class="hero-input"
          :placeholder="t('expenseModal.titlePlaceholder')"
        />
        <div class="hero-amount">
          <button class="hero-cur" type="button" @click="showCur = !showCur">
            {{ currency }} ▾
          </button>
          <input
            v-model="amount"
            type="number"
            step="0.01"
            min="0"
            class="hero-num"
            :placeholder="t('expenseModal.amountPlaceholder')"
            :disabled="splitType === 'items'"
          />
        </div>
        <div v-if="showCur" class="cur-list">
          <button
            v-for="c in CURRENCIES"
            :key="c"
            class="cur-item"
            @click="
              currency = c;
              showCur = false;
            "
          >
            {{ c }}
          </button>
        </div>
        <div v-if="splitType !== 'items'" class="field">
          <label>{{ t("expenseModal.description") }}</label>
          <textarea
            v-model="description"
            rows="2"
            :placeholder="t('expenseModal.descriptionPlaceholder')"
          ></textarea>
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
        <div v-if="showRate" class="field">
          <label>
            {{ t("expenseModal.exchangeRate", { currency, base: group.baseCurrency }) }}
          </label>
          <input
            v-model.number="exchangeRate"
            type="number"
            step="0.0001"
            min="0"
          />
        </div>
        <div class="field">
          <label>{{ t("expenseModal.date") }}</label>
          <input v-model="date" type="date" :disabled="isRecurring" />
        </div>
        <div v-if="!initial" class="field">
          <label class="check-row">
            <input v-model="isRecurring" type="checkbox" />
            <span>{{ t("expenseModal.recurring") }}</span>
          </label>
          <div v-if="isRecurring" style="margin-top: 10px">
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
          <div v-if="isRecurring" class="field" style="margin-top: 10px">
            <label>{{ t("expenseModal.startDate") }}</label>
            <input v-model="startDate" type="date" />
          </div>
        </div>
        <div class="field">
          <label>{{ t("expenseModal.split") }}</label>
          <div class="segmented">
            <button
              v-for="s in splitTypes"
              :key="s.value"
              :class="{ active: splitType === s.value }"
              @click="setSplitType(s.value)"
            >
              {{ t(s.label) }}
            </button>
          </div>
          <div v-if="splitType === 'items'">
            <button class="items-card" type="button" @click="showItems = true">
              <span class="items-ic">🧾</span>
              <span class="items-txt">
                {{
                  items.items.length
                    ? `${items.items.length} ${t("expenseModal.splitItems")} · ${fmt(itemsTotal, currency)}`
                    : t("expenseModal.noItems")
                }}
              </span>
              <span class="items-edit">
                {{ items.items.length ? t("expenseModal.editItems") : t("expenseModal.addItems") }}
              </span>
            </button>
          </div>
          <div v-else>
            <div v-for="id in memberIds" :key="id" class="split-row">
              <input
                type="checkbox"
                :checked="isChecked(id)"
                @change="toggleParticipant(id)"
              />
              <span class="nm">{{ nameOf(id, me) }}</span>
              <span
                v-if="splitType === 'equal'"
                style="
                  width: 84px;
                  text-align: right;
                  font-size: 13px;
                  color: var(--ink-faint);
                "
              >
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
            v-if="splitType !== 'equal' && splitType !== 'items'"
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
  <ItemsModal
    v-if="showItems"
    :member-ids="memberIds"
    :me="me"
    :currency="currency"
    :initial="items"
    @close="showItems = false"
    @save="
      items = $event;
      showItems = false;
    "
    @error="emit('error', $event)"
  />
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
.hero-input:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
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
.items-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-top: 10px;
  padding: 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  background: var(--bg);
  cursor: pointer;
  font-family: var(--sans);
}
.items-card:active {
  background: var(--bg-sunken);
}
.items-ic {
  font-size: 18px;
}
.items-txt {
  flex: 1;
  font-size: 14px;
  color: var(--ink);
  text-align: left;
}
.items-edit {
  font-size: 12.5px;
  color: var(--accent);
  font-weight: 700;
}
</style>
