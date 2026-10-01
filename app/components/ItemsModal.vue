<script setup lang="ts">
import {
  fmt,
  type ItemsData,
  type Profile,
} from "~/utils/format";
import { useProfiles } from "~/composables/useGroups";
import { itemsTotals, type ExpenseItem } from "~/utils/splits";

const { t } = useI18n();

interface DraftItem extends ExpenseItem {
  enabled: boolean;
}

const props = defineProps<{
  memberIds: string[];
  me: Profile;
  currency: string;
  initial: ItemsData;
}>();
const emit = defineEmits<{
  close: [];
  save: [data: ItemsData];
  error: [msg: string];
}>();

const { nameOf } = useProfiles();

const rows = ref<DraftItem[]>(
  props.initial.items.length
    ? props.initial.items.map((it) => ({
        name: it.name,
        price: it.price,
        members: [...it.members],
        enabled: true,
      }))
    : [{ name: "", price: 0, members: [...props.memberIds], enabled: true }],
);

const gridCols = computed(
  () =>
    `minmax(96px,1.5fr) 68px repeat(${props.memberIds.length}, minmax(58px,auto)) 30px 30px`,
);

const enabledRows = computed(() => rows.value.filter((r) => r.enabled));
const grandPerPerson = computed(() =>
  itemsTotals(enabledRows.value, props.memberIds),
);
const grandTotal = computed(() =>
  Math.round(
    props.memberIds.reduce((s, id) => s + (grandPerPerson.value[id] || 0), 0) *
      100,
  ) / 100,
);

function sharesFor(it: DraftItem): number[] {
  const shares = props.memberIds.map(() => 0);
  if (!it.enabled) return shares;
  const enabledIdx = props.memberIds
    .map((id, i) => (it.members.includes(id) ? i : -1))
    .filter((i) => i >= 0);
  if (!enabledIdx.length || !(it.price > 0)) return shares;
  const each = Math.round((it.price / enabledIdx.length) * 100) / 100;
  let running = 0;
  enabledIdx.forEach((idx, k) => {
    const v =
      k === enabledIdx.length - 1
        ? Math.round((it.price - running) * 100) / 100
        : each;
    running += v;
    shares[idx] = v;
  });
  return shares;
}

function toggle(item: DraftItem, id: string) {
  const i = item.members.indexOf(id);
  if (i >= 0) item.members.splice(i, 1);
  else item.members.push(id);
}

function addItem() {
  rows.value.push({ name: "", price: 0, members: [...props.memberIds], enabled: true });
}

function removeItem(index: number) {
  rows.value.splice(index, 1);
}

function done() {
  const list = enabledRows.value;
  if (!list.length) {
    emit("error", t("itemsModal.errorItem"));
    return;
  }
  for (const it of list) {
    if (!it.name.trim()) {
      emit("error", t("itemsModal.errorName"));
      return;
    }
    if (!(it.price > 0)) {
      emit("error", t("itemsModal.errorPrice"));
      return;
    }
    if (!it.members.length) {
      emit("error", t("itemsModal.errorAssigned", { name: it.name.trim() }));
      return;
    }
  }
  emit("save", {
    items: list.map((it) => ({
      name: it.name.trim(),
      price: Math.round(it.price * 100) / 100,
      members: [...it.members],
    })),
    tax: 0,
    tipPercent: 0,
  });
}
</script>

<template>
  <div class="overlay" style="z-index: 70" @click.self="emit('close')">
    <div class="sheet-wrap">
      <div class="sheet">
        <button class="close-x" @click="emit('close')">✕</button>
        <h2>{{ t("itemsModal.title") }}</h2>
        <div style="font-size: 13px; color: var(--ink-soft); margin-bottom: 12px">
          {{ t("itemsModal.instructions") }}
        </div>
        <div style="overflow-x: auto">
          <div
            :style="{
              display: 'grid',
              gridTemplateColumns: gridCols,
              gap: '6px',
              alignItems: 'center',
              minWidth: 'max-content',
            }"
          >
            <span class="col-h">{{ t("itemsModal.item") }}</span>
            <span class="col-h" style="text-align: right">$</span>
            <span
              v-for="id in memberIds"
              :key="'h-' + id"
              :title="nameOf(id, me)"
              class="col-h"
              style="text-align: right"
              >{{ nameOf(id, me) }}</span
            >
            <span></span>
            <span></span>

            <template v-for="(it, i) in rows" :key="i">
              <input
                v-model="it.name"
                type="text"
                class="cell-input"
                :disabled="!it.enabled"
              />
              <input
                v-model.number="it.price"
                type="number"
                step="0.01"
                min="0"
                class="cell-input"
                style="text-align: right"
                :disabled="!it.enabled"
              />
              <button
                v-for="(id, k) in memberIds"
                :key="id"
                class="btn btn-sm share-cell"
                :class="{ 'btn-accent': it.enabled && it.members.includes(id) }"
                :style="
                  it.enabled && it.members.includes(id)
                    ? ''
                    : 'opacity: 0.45'
                "
                :disabled="!it.enabled"
                :title="nameOf(id, me)"
                @click="toggle(it, id)"
              >
                {{
                  it.enabled && it.members.includes(id)
                    ? fmt(sharesFor(it)[k] ?? 0, currency)
                    : "—"
                }}
              </button>
              <input
                v-model="it.enabled"
                type="checkbox"
                class="row-check"
                :title="t('itemsModal.includeItem')"
              />
              <button
                class="btn btn-sm btn-ghost remove-btn"
                :title="t('itemsModal.removeItem')"
                :disabled="rows.length <= 1"
                @click="removeItem(i)"
              >
                ✕
              </button>
            </template>

            <div class="add-row">
              <button class="btn btn-sm" @click="addItem">
                {{ t("itemsModal.addItem") }}
              </button>
            </div>

            <span class="row-label" style="font-weight: 700">{{ t("itemsModal.total") }}</span>
            <span class="row-amt" style="font-weight: 700">{{
              fmt(grandTotal, currency)
            }}</span>
            <span
              v-for="id in memberIds"
              :key="'g-' + id"
              class="row-amt"
              style="font-weight: 700"
              >{{ fmt(grandPerPerson[id] || 0, currency) }}</span
            >
            <span></span>
            <span></span>
          </div>
        </div>
        <div
          v-for="(it, i) in rows"
          :key="'warn-' + i"
        >
          <div
            v-if="it.enabled && !it.members.length"
            style="font-size: 12px; color: var(--negative); margin-top: 6px"
          >
            {{ t("itemsModal.nobodyAssigned", { name: it.name || `${t("itemsModal.item")} ${i + 1}` }) }}
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-accent btn-block" @click="done">
            {{ t("itemsModal.done") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.col-h {
  font-size: 11px;
  color: var(--ink-faint);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-input {
  width: 100%;
  min-width: 0;
  padding: 8px 9px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  background: var(--bg);
  color: var(--ink);
  font-size: 14px;
  font-family: var(--sans);
}
.cell-input:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.cell-input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
}
.cell-input[type="number"]::-webkit-outer-spin-button,
.cell-input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.cell-input:disabled {
  opacity: 0.45;
}
.share-cell {
  font-variant-numeric: tabular-nums;
  min-width: 58px;
}
.row-check {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
  justify-self: center;
}
.remove-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 12px;
  line-height: 1;
  color: var(--negative);
  justify-self: center;
}
.remove-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.add-row {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-start;
}
.row-label {
  font-size: 13.5px;
  color: var(--ink);
}
.row-amt {
  font-size: 13px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ink-soft);
}
</style>
