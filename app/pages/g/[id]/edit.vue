<script setup lang="ts">
import { CURRENCIES, type Group, type Profile } from "~/utils/format";
import { useAuth } from "~/composables/useAuth";
import { useProfiles } from "~/composables/useGroups";
import AddMemberModal from "~/components/AddMemberModal.vue";
import ImportModal from "~/components/ImportModal.vue";
import LanguageSwitcher from "~/components/LanguageSwitcher.vue";

const { t } = useI18n();

const route = useRoute();
const gid = String(route.params.id);
const { user, fetchMe } = useAuth();
const { profiles, nameOf, ensure } = useProfiles();

const group = ref<Group | null>(null);
const loading = ref(true);
const toast = ref<string | null>(null);
const saving = ref(false);
const showAddMember = ref(false);
const showImport = ref(false);
const confirmRemoveMember = ref<string | null>(null);
const confirmLeave = ref(false);
const leaving = ref(false);
const hasExpenses = ref(false);

// Local form state, seeded from the group once it loads.
const name = ref("");
const emoji = ref("🧾");
const currency = ref("EUR");
const simplifyTransfers = ref(true);
const seeded = ref(false);

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, 2400);
}

const canManage = computed(() => {
  if (!group.value || !user.value) return false;
  return group.value.createdBy === user.value.id || user.value.role === "admin";
});

/** A plain member can leave; the creator cannot, or the group is orphaned. */
const canLeave = computed(
  () =>
    !!group.value &&
    !!user.value &&
    group.value.memberIds.includes(user.value.id) &&
    group.value.createdBy !== user.value.id,
);

async function leaveGroup() {
  if (!group.value || !user.value) return;
  leaving.value = true;
  try {
    await $fetch(`/api/groups/${gid}/members/${user.value.id}`, {
      method: "DELETE",
    });
    await navigateTo("/");
  } catch (e: unknown) {
    showToast((e as Error)?.message || t("groupEdit.leaveFailed"));
  } finally {
    leaving.value = false;
  }
}

async function load() {
  try {
    group.value = await $fetch<Group>(`/api/groups/${gid}`);
    await ensure(group.value.memberIds || []);
    // Drives the currency lock; the server is the authority either way.
    try {
      const expenses = await $fetch<unknown[]>(`/api/groups/${gid}/expenses`);
      hasExpenses.value = expenses.length > 0;
    } catch {
      hasExpenses.value = false;
    }
    if (!seeded.value) {
      name.value = group.value.name;
      emoji.value = group.value.emoji || "🧾";
      currency.value = group.value.baseCurrency;
      simplifyTransfers.value = group.value.simplifyTransfers !== false;
      seeded.value = true;
    }
  } catch (e: unknown) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 403 || status === 404) await navigateTo("/");
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    await $fetch(`/api/groups/${gid}`, {
      method: "PATCH",
      body: {
        name: name.value,
        emoji: emoji.value,
        baseCurrency: currency.value,
        simplifyTransfers: simplifyTransfers.value,
      },
    });
    await load();
    showToast(t("groupEdit.saved"));
  } catch (e: unknown) {
    showToast((e as Error)?.message || t("groupEdit.couldntSave"));
  } finally {
    saving.value = false;
  }
}

async function removeMember(uid: string) {
  try {
    await $fetch(`/api/groups/${gid}/members/${uid}`, { method: "DELETE" });
    confirmRemoveMember.value = null;
    await load();
  } catch (e: unknown) {
    showToast((e as Error)?.message || t("group.couldntRemove"));
  }
}

onMounted(async () => {
  const me = await fetchMe();
  if (!me) {
    await navigateTo("/login");
    return;
  }
  await load();
});
</script>

<template>
  <div>
    <div class="topbar">
      <button class="back-btn" @click="navigateTo(`/g/${gid}`)">
        ‹ {{ t("groupEdit.back") }}
      </button>
      <div class="spacer"></div>
      <LanguageSwitcher />
    </div>

    <main>
      <div v-if="loading || !group" class="empty">
        <span class="icon">🧾</span>
        <h3>{{ t("group.loading") }}</h3>
      </div>

      <template v-else>
        <div class="group-head">
          <div class="title">
            <h1>{{ t("groupEdit.title") }}</h1>
            <p style="font-size: 13px; color: var(--ink-faint); margin: 4px 0 0">
              {{ group.emoji || "🧾" }} {{ group.name }}
            </p>
          </div>
        </div>

        <div v-if="!canManage" class="notice">
          {{ t("groupEdit.readOnly") }}
        </div>

        <!-- Details -->
        <div class="section-label">{{ t("groupEdit.details") }}</div>
        <div class="card">
          <div class="row2">
            <div class="field">
              <label>{{ t("groupModal.emoji") }}</label>
              <input
                v-model="emoji"
                type="text"
                maxlength="2"
                :disabled="!canManage"
                style="width: 60px; text-align: center; font-size: 18px"
              />
            </div>
            <div class="field">
              <label>{{ t("groupModal.name") }}</label>
              <input v-model="name" type="text" :disabled="!canManage" maxlength="80" />
            </div>
          </div>
          <div class="field">
            <label>{{ t("groupEdit.currencyNote") }}</label>
            <select v-model="currency" :disabled="!canManage || hasExpenses">
              <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
            </select>
            <p style="font-size: 12px; color: var(--ink-faint); margin: 6px 0 0">
              {{ hasExpenses ? t("groupEdit.currencyLocked") : t("groupEdit.currencyHint") }}
            </p>
          </div>
          <div class="field">
            <label class="check-row">
              <input v-model="simplifyTransfers" type="checkbox" :disabled="!canManage" />
              <span>{{ t("groupEdit.simplifyTransfers") }}</span>
            </label>
            <p style="font-size: 12px; color: var(--ink-faint); margin: 6px 0 0">
              {{ t("groupEdit.simplifyTransfersHint") }}
            </p>
          </div>
          <div v-if="canManage" class="modal-actions" style="margin-top: 14px">
            <button class="btn btn-accent" :disabled="saving" @click="save">
              {{ t("groupEdit.save") }}
            </button>
          </div>
        </div>

        <!-- Members -->
        <div class="section-label" style="margin-top: 22px">
          {{ t("groupEdit.members") }}
        </div>
        <div class="card">
          <div v-if="canManage" style="margin-bottom: 12px">
            <button class="btn btn-sm" @click="showAddMember = true">
              {{ t("group.addPerson") }}
            </button>
          </div>
          <div
            v-for="id in group.memberIds"
            :key="id"
            class="balance-row"
            style="border-bottom: none; padding: 10px 0"
          >
            <span class="name">{{ nameOf(id, user) }}</span>
            <span
              v-if="id === group.createdBy"
              style="font-size: 12px; color: var(--ink-faint)"
            >
              {{ t("groupEdit.creator") }}
            </span>
            <span v-else-if="id === user?.id" style="font-size: 12px; color: var(--ink-faint)">
              {{ t("groupEdit.you") }}
            </span>
            <button
              v-if="canManage && id !== user?.id"
              class="btn btn-sm btn-ghost"
              style="color: var(--negative)"
              @click="confirmRemoveMember = id"
            >
              {{ t("group.remove") }}
            </button>
          </div>
          <div
            v-if="canLeave"
            style="border-top: 1px solid var(--line); margin-top: 10px; padding-top: 12px"
          >
            <button
              class="btn btn-sm btn-ghost"
              style="color: var(--negative)"
              :disabled="leaving"
              @click="confirmLeave = true"
            >
              {{ leaving ? t("groupEdit.leaving") : t("groupEdit.leave") }}
            </button>
          </div>
        </div>

        <!-- Import -->
        <div class="section-label" style="margin-top: 22px">
          {{ t("groupEdit.import") }}
        </div>
        <div class="card">
          <p style="font-size: 13px; color: var(--ink-soft); margin: 0 0 12px">
            {{ t("groupEdit.importHint") }}
          </p>
          <button class="btn btn-accent" @click="showImport = true">
            {{ t("group.importSplitwise") }}
          </button>
        </div>
      </template>
    </main>

    <div v-if="toast" class="toast">{{ toast }}</div>

    <AddMemberModal
      v-if="showAddMember && group"
      :group-id="gid"
      :group-name="group.name"
      :existing="group.memberIds"
      @close="showAddMember = false"
      @added="
        showAddMember = false;
        load();
      "
      @error="showToast($event)"
    />
    <ImportModal
      v-if="showImport && group && user"
      :group="group"
      :me="user"
      @close="showImport = false"
      @imported="showImport = false"
      @error="showToast($event)"
    />

    <!-- Leave group confirmation -->
    <div v-if="confirmLeave" class="overlay" @click.self="confirmLeave = false">
      <div class="sheet-wrap">
        <div class="sheet">
          <h2>{{ t("groupEdit.leave") }}</h2>
          <p style="font-size: 14px; color: var(--ink-soft)">
            {{ t("groupEdit.leaveConfirm") }}
          </p>
          <div class="modal-actions">
            <button class="btn" @click="confirmLeave = false">
              {{ t("group.cancel") }}
            </button>
            <button
              class="btn btn-accent"
              style="flex: 1"
              :disabled="leaving"
              @click="leaveGroup"
            >
              {{ t("groupEdit.leave") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Remove member confirmation -->
    <div v-if="confirmRemoveMember" class="overlay" @click.self="confirmRemoveMember = null">
      <div class="sheet-wrap">
        <div class="sheet">
          <h2>{{ t("group.removeMember") }}</h2>
          <p style="font-size: 14px; color: var(--ink-soft)">
            {{
              t("group.removeMemberConfirm", {
                name: nameOf(confirmRemoveMember, user),
              })
            }}
          </p>
          <p style="font-size: 12px; color: var(--ink-faint)">
            {{ t("groupEdit.removeHint") }}
          </p>
          <div class="modal-actions">
            <button class="btn" @click="confirmRemoveMember = null">
              {{ t("group.cancelRemove") }}
            </button>
            <button
              class="btn btn-accent"
              style="flex: 1"
              @click="removeMember(confirmRemoveMember)"
            >
              {{ t("group.remove") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 16px;
}
.notice {
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 12px 14px;
  font-size: 13px;
  color: var(--ink-soft);
  margin-bottom: 16px;
}
</style>
