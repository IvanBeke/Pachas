<script setup lang="ts">
import { fmt, type Group, type Profile } from "~/utils/format";
import { useProfiles } from "~/composables/useGroups";
import type { SuggestedTransfer } from "~/composables/useGroupDetail";
import { transferKey, visibleTransfers } from "~/utils/settle";
import { GroupRole } from "../../shared/group-roles";

const { t } = useI18n();

const props = defineProps<{
  group: Group;
  me: Profile;
  preset?: { from: string; to: string };
  /** The server's suggested payments, each with its outstanding amount. */
  transfers: SuggestedTransfer[];
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

const note = ref("");
const initial =
  props.preset && rows.value.some((row) => transferKey(row) === transferKey(props.preset!))
    ? transferKey(props.preset)
    : rows.value.length === 1
      ? transferKey(rows.value[0]!)
      : null;
const selected = ref<string | null>(initial);

// The group refreshes while the modal is open: if the chosen payment is gone
// (someone else settled it), the choice is dropped instead of silently failing.
const current = computed(() => rows.value.find((row) => transferKey(row) === selected.value));
watch(rows, () => {
  if (selected.value && !current.value) selected.value = null;
});

/** The server recomputes the debt and records it in full; nothing is sent but the pair. */
async function submit() {
  const row = current.value;
  if (!row) return;
  try {
    await $fetch(`/api/groups/${props.group.id}/settlements`, {
      method: "POST",
      body: { from: row.from, to: row.to, note: note.value.trim() },
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
        <div v-if="!rows.length" class="empty" style="padding: 30px 10px">
          <span class="icon">✅</span>
          <p>{{ t(isGroupElevated ? "group.everyoneSettled" : "group.noDebtsToSettle") }}</p>
        </div>
        <template v-else>
          <div class="field">
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
                @click="selected = transferKey(row)"
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
            </div>
          </div>
          <div class="field">
            <label>{{ t("settleModal.note") }}</label>
            <input
              v-model="note"
              type="text"
              :placeholder="t('settleModal.notePlaceholder')"
            />
          </div>
          <div class="modal-actions">
            <button class="btn btn-block btn-accent" :disabled="!current" @click="submit">
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
</style>
