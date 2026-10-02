<script setup lang="ts">
import { fmt, type Group, type Profile } from "~/utils/format";
import { useProfiles } from "~/composables/useGroups";
import { GroupRole } from "../../shared/group-roles";

const { t } = useI18n();

const props = defineProps<{
  group: Group;
  me: Profile;
  preset?: { from: string; to: string };
  /** Outstanding debt per pair, from the server's plan. Drives the preview. */
  plan?: { from: string; to: string; amount: number }[];
}>();
const emit = defineEmits<{ close: []; saved: []; error: [msg: string] }>();

const { nameOf } = useProfiles();
const memberIds = computed(() => props.group.memberIds || []);
const role = computed(
  () => props.group.members.find((member) => member.userId === props.me.id)?.role,
);
const isGroupElevated = computed(
  () => role.value === GroupRole.Creator || role.value === GroupRole.Admin,
);
const fromOptions = computed(() =>
  isGroupElevated.value ? memberIds.value : [props.me.id],
);
const from = ref(
  isGroupElevated.value ? props.preset?.from || props.me.id : props.me.id,
);
const to = ref(
  props.preset?.to ||
    (memberIds.value.filter((id) => id !== props.me.id)[0] || ""),
);
const note = ref("");

/**
 * What the server will actually record for this pair: the outstanding debt,
 * capped by what the payee is owed overall. Sent as a hint only — the server
 * recomputes and rejects anything above the real debt, so this cannot be used
 * to inflate a settlement.
 */
const debtBetween = computed(() => {
  const hit = (props.plan || []).find(
    (t) => t.from === from.value && t.to === to.value,
  );
  return hit?.amount ?? null;
});

async function submit() {
  if (from.value === to.value) {
    emit("error", t("settleModal.errorDifferent"));
    return;
  }
  if (debtBetween.value === null) {
    emit("error", t("settleModal.errorNoDebt"));
    return;
  }
  try {
    await $fetch(`/api/groups/${props.group.id}/settlements`, {
      method: "POST",
      body: {
        from: from.value,
        to: to.value,
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
    <div class="sheet-wrap">
      <div class="sheet">
        <button class="close-x" @click="emit('close')">✕</button>
        <h2>{{ t("settleModal.title") }}</h2>
        <div class="row2">
          <div class="field">
            <label>{{ t("settleModal.from") }}</label>
            <select v-model="from" :disabled="!isGroupElevated">
              <option v-for="id in fromOptions" :key="id" :value="id">
                {{ nameOf(id, me) }}
              </option>
            </select>
          </div>
          <div class="field">
            <label>{{ t("settleModal.to") }}</label>
            <select v-model="to">
              <option v-for="id in memberIds" :key="id" :value="id">
                {{ nameOf(id, me) }}
              </option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>{{ t("settleModal.amount", { currency: group.baseCurrency }) }}</label>
          <div class="debt-box" :class="{ none: debtBetween === null }">
            <template v-if="debtBetween !== null">
              {{ fmt(debtBetween, group.baseCurrency) }}
            </template>
            <template v-else>{{ t("settleModal.noDebt") }}</template>
          </div>
          <p v-if="debtBetween !== null" style="font-size: 12px; color: var(--ink-faint); margin: 6px 0 0">
            {{ t("settleModal.amountNote") }}
          </p>
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
          <button
            class="btn btn-block btn-accent"
            :disabled="debtBetween === null"
            @click="submit"
          >
            {{ t("settleModal.record") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.debt-box {
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 12px;
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.debt-box.none {
  font-size: 13px;
  font-weight: 400;
  color: var(--ink-faint);
}
</style>
