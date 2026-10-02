<script setup lang="ts">
import { CURRENCIES, type Group, type Profile } from "~/utils/format";
import { useAuth } from "~/composables/useAuth";
import { useProfiles } from "~/composables/useGroups";
import AddMemberModal from "~/components/AddMemberModal.vue";
import ImportModal from "~/components/ImportModal.vue";
import LanguageSwitcher from "~/components/LanguageSwitcher.vue";
import { GroupRole } from "../../../../shared/group-roles";

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
const confirmDeleteGroup = ref(false);
const leaving = ref(false);
const hasExpenses = ref(false);

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
  const role = group.value.members.find((member) => member.userId === user.value?.id)?.role;
  return role === GroupRole.Creator || role === GroupRole.Admin;
});

const isCreator = computed(() =>
  !!group.value &&
  !!user.value &&
  group.value.members.some(
    (member) => member.userId === user.value?.id && member.role === GroupRole.Creator,
  ),
);

function roleOf(uid: string): GroupRole | null {
  return group.value?.members.find((member) => member.userId === uid)?.role ?? null;
}

const canLeave = computed(
  () =>
    !!group.value &&
    !!user.value &&
    group.value.memberIds.includes(user.value.id) &&
    !isCreator.value,
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
    showToast(groupActionError(e, t("groupEdit.leaveFailed")));
  } finally {
    leaving.value = false;
  }
}

async function load() {
  try {
    group.value = await $fetch<Group>(`/api/groups/${gid}`);
    await ensure(group.value.memberIds || []);
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
    showToast(groupActionError(e, t("groupEdit.couldntSave")));
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
    showToast(groupActionError(e, t("group.couldntRemove")));
  }
}

function groupActionError(error: unknown, fallback: string): string {
  const data = (error as { data?: { message?: string; statusMessage?: string } })?.data;
  const code = data?.message || data?.statusMessage;
  if (code === "member_has_outstanding_payments") {
    return t("groupEdit.memberHasOutstandingPayments");
  }
  if (code === "pairwise_plan_includes_former_members") {
    return t("groupEdit.pairwiseFormerMembers");
  }
  return (error as Error)?.message || fallback;
}

async function changeMemberRole(uid: string, event: Event) {
  if (!group.value) return;
  const select = event.target as HTMLSelectElement;
  const role = select.value as GroupRole;
  if (
    role === GroupRole.Creator &&
    !window.confirm(
      t("groupEdit.transferCreatorConfirm", { name: nameOf(uid, user.value) }),
    )
  ) {
    select.value = roleOf(uid) || GroupRole.Member;
    return;
  }
  try {
    await $fetch(`/api/groups/${gid}/members/${uid}`, {
      method: "PATCH",
      body: { role },
    });
    await load();
  } catch (e: unknown) {
    select.value = roleOf(uid) || GroupRole.Member;
    showToast((e as Error)?.message || t("groupEdit.roleFailed"));
  }
}

async function deleteGroup() {
  try {
    await $fetch(`/api/groups/${gid}`, { method: "DELETE" });
    await navigateTo("/");
  } catch (e: unknown) {
    showToast((e as Error)?.message || t("groupEdit.deleteFailed"));
  } finally {
    confirmDeleteGroup.value = false;
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

        <div class="section-label" style="margin-top: 22px">
          {{ t("groupEdit.members") }}
        </div>
        <div class="card">
          <div style="margin-bottom: 12px">
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
              v-if="roleOf(id)"
              style="font-size: 12px; color: var(--ink-faint)"
            >
              {{ t(`groupEdit.role_${roleOf(id)}`) }}
            </span>
            <button
              v-if="canManage && roleOf(id) !== GroupRole.Creator && id !== user?.id"
              class="btn btn-sm btn-ghost"
              style="color: var(--negative)"
              @click="confirmRemoveMember = id"
            >
              {{ t("group.remove") }}
            </button>
            <select
              v-if="canManage && roleOf(id) !== GroupRole.Creator"
              :value="roleOf(id) || GroupRole.Member"
              class="role-select"
              @change="changeMemberRole(id, $event)"
            >
              <option :value="GroupRole.Member">{{ t("groupEdit.role_member") }}</option>
              <option :value="GroupRole.Admin">{{ t("groupEdit.role_admin") }}</option>
              <option v-if="isCreator" :value="GroupRole.Creator">
                {{ t("groupEdit.role_creator") }}
              </option>
            </select>
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

        <template v-if="canManage">
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

        <div v-if="isCreator" class="card danger-card">
          <div class="section-label">{{ t("groupEdit.deleteGroup") }}</div>
          <p style="font-size: 13px; color: var(--ink-soft); margin: 0 0 12px">
            {{ t("groupEdit.deleteGroupHint") }}
          </p>
          <button
            class="btn btn-ghost"
            style="color: var(--negative)"
            @click="confirmDeleteGroup = true"
          >
            {{ t("groupEdit.deleteGroup") }}
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

    <div v-if="confirmDeleteGroup" class="overlay" @click.self="confirmDeleteGroup = false">
      <div class="sheet-wrap">
        <div class="sheet">
          <h2>{{ t("groupEdit.deleteGroup") }}</h2>
          <p style="font-size: 14px; color: var(--ink-soft)">
            {{ t("groupEdit.deleteGroupConfirm", { name: group?.name }) }}
          </p>
          <div class="modal-actions">
            <button class="btn" @click="confirmDeleteGroup = false">
              {{ t("group.cancel") }}
            </button>
            <button
              class="btn btn-accent"
              style="flex: 1; background: var(--negative)"
              @click="deleteGroup"
            >
              {{ t("groupEdit.deleteGroup") }}
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
.role-select {
  width: auto;
  min-width: 96px;
  padding: 6px 8px;
}
.danger-card {
  margin-top: 22px;
  border-color: var(--negative);
}
</style>
