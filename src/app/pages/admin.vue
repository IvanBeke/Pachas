<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import { timeAgo, translatedTitle } from "~/utils/format";

const { t, locale } = useI18n();

const { user, fetchMe } = useAuth();
const tab = ref<"overview" | "categories">("overview");

interface AdminUser {
  id: string;
  name: string;
  username: string;
  role: string;
  createdAt: number;
}
interface AdminGroup {
  id: string;
  name: string;
  emoji: string | null;
  baseCurrency: string;
  createdAt: number;
}
interface AdminData {
  counts: { users: number; groups: number; expenses: number; settlements: number };
  users: AdminUser[];
  groups: AdminGroup[];
}
interface Category {
  id: number;
  title: string;
  icon: string;
  translations?: Record<string, string>;
}

const data = ref<AdminData | null>(null);
const toast = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const newTitle = ref("");
const newTitleEn = ref("");
const newIcon = ref("🧾");
const editingId = ref<number | null>(null);
const editTitle = ref("");
const editTitleEn = ref("");
const editIcon = ref("");
const deleteTarget = ref<number | null>(null);
const migrateTo = ref<number | 0>(0);

function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, 2400);
}

async function load() {
  try {
    data.value = await $fetch<AdminData>("/api/admin/overview");
  } catch (e: unknown) {
    showToast((e as Error)?.message || t("admin.couldntLoad"));
  }
}

const { categories, refresh: loadCategories } = useCategories();

async function addCategory() {
  const title = newTitle.value.trim();
  if (!title) return;
  const titleEn = newTitleEn.value.trim();
  try {
    await $fetch("/api/categories", {
      method: "POST",
      body: {
        title,
        icon: newIcon.value || "🧾",
        translations: titleEn ? { en: titleEn } : undefined,
      },
    });
    newTitle.value = "";
    newTitleEn.value = "";
    newIcon.value = "🧾";
    await loadCategories();
  } catch (e: unknown) {
    showToast((e as Error)?.message || t("admin.couldntAdd"));
  }
}

function startEdit(c: Category) {
  editingId.value = c.id;
  editTitle.value = c.title;
  editTitleEn.value = c.translations?.en || "";
  editIcon.value = c.icon;
}

async function saveEdit(id: number) {
  const titleEn = editTitleEn.value.trim();
  try {
    await $fetch(`/api/categories/${id}`, {
      method: "PATCH",
      body: {
        title: editTitle.value,
        icon: editIcon.value,
        translations: titleEn ? { en: titleEn } : undefined,
      },
    });
    editingId.value = null;
    await loadCategories();
  } catch (e: unknown) {
    showToast((e as Error)?.message || t("admin.couldntUpdate"));
  }
}

function askDelete(id: number) {
  deleteTarget.value = id;
  const first = categories.value.find((c) => c.id !== id);
  migrateTo.value = first ? first.id : 0;
}

async function removeCategory() {
  if (!deleteTarget.value) return;
  try {
    await $fetch(`/api/categories/${deleteTarget.value}`, {
      method: "DELETE",
      body: { migrateTo: migrateTo.value },
    });
    deleteTarget.value = null;
    await loadCategories();
  } catch (e: unknown) {
    showToast((e as Error)?.message || t("admin.couldntDelete"));
  }
}

onMounted(async () => {
  const me = await fetchMe();
  if (!me) {
    await navigateTo("/login");
    return;
  }
  if (me.role !== "admin") {
    await navigateTo("/");
    return;
  }
  await Promise.all([load(), loadCategories()]);
});
</script>

<template>
  <div>
    <div class="topbar">
      <button class="back-btn" @click="navigateTo('/')">‹ {{ t("common.groups") }}</button>
      <div class="brand"><span class="mark">P</span>{{ t("common.admin") }}</div>
      <div class="spacer"></div>
    </div>
    <main>
      <div class="tabs">
        <button
          class="tab"
          :class="{ active: tab === 'overview' }"
          @click="tab = 'overview'"
        >
          {{ t("admin.overview") }}
        </button>
        <button
          class="tab"
          :class="{ active: tab === 'categories' }"
          @click="tab = 'categories'"
        >
          {{ t("admin.categories") }}
        </button>
      </div>

      <div v-if="tab === 'overview'">
        <div v-if="!data" class="empty">
          <span class="icon">📊</span>
          <h3>{{ t("admin.loading") }}</h3>
        </div>
        <template v-else>
          <div class="section-label">{{ t("admin.counts") }}</div>
          <div class="balance-row">
            <span class="name">{{ t("admin.users") }}</span>
            <span class="amt">{{ data.counts.users }}</span>
          </div>
          <div class="balance-row">
            <span class="name">{{ t("admin.groups") }}</span>
            <span class="amt">{{ data.counts.groups }}</span>
          </div>
          <div class="balance-row">
            <span class="name">{{ t("admin.expenses") }}</span>
            <span class="amt">{{ data.counts.expenses }}</span>
          </div>
          <div class="balance-row">
            <span class="name">{{ t("admin.settlements") }}</span>
            <span class="amt">{{ data.counts.settlements }}</span>
          </div>
          <div class="section-label" style="margin-top: 22px">{{ t("admin.users") }}</div>
          <div v-for="u in data.users" :key="u.id" class="balance-row">
            <span class="name">
              {{ u.name }}
              <span style="font-size: 12px; color: var(--ink-faint)"
                >@{{ u.username }}</span
              >
            </span>
            <span
              class="amt"
              :class="u.role === 'admin' ? 'pos' : 'neu'"
              style="font-size: 12.5px"
            >
              {{ u.role }}
            </span>
          </div>
          <div class="section-label" style="margin-top: 22px">{{ t("admin.groups") }}</div>
          <div v-for="g in data.groups" :key="g.id" class="balance-row">
            <span class="name">{{ g.emoji || "🧾" }} {{ g.name }}</span>
            <span class="amt" style="font-size: 12.5px">{{ g.baseCurrency }}</span>
          </div>
        </template>
      </div>

      <div v-if="tab === 'categories'">
        <div class="section-label">{{ t("admin.addCategory") }}</div>
        <div class="row2">
          <div class="field">
            <label>{{ t("admin.title") }} (ES)</label>
            <input v-model="newTitle" type="text" :placeholder="t('admin.titlePlaceholder')" />
          </div>
          <div class="field">
            <label>{{ t("admin.title") }} (EN)</label>
            <input v-model="newTitleEn" type="text" :placeholder="t('admin.titlePlaceholder')" />
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label>{{ t("admin.icon") }}</label>
            <input v-model="newIcon" type="text" maxlength="4" style="width: 70px" />
          </div>
        </div>
        <button class="btn btn-sm btn-accent" style="margin-bottom: 18px" @click="addCategory">
          {{ t("admin.addCategoryButton") }}
        </button>
        <div class="section-label">{{ t("admin.existing") }}</div>
        <div v-for="c in categories" :key="c.id" class="balance-row">
          <template v-if="editingId === c.id">
            <input v-model="editTitle" type="text" style="flex: 1" :placeholder="t('admin.title') + ' (ES)'" />
            <input v-model="editTitleEn" type="text" style="flex: 1" :placeholder="t('admin.title') + ' (EN)'" />
            <input v-model="editIcon" type="text" maxlength="4" style="width: 56px" />
            <button class="btn btn-sm btn-accent" @click="saveEdit(c.id)">{{ t("common.save") }}</button>
            <button class="btn btn-sm" @click="editingId = null">{{ t("common.cancel") }}</button>
          </template>
          <template v-else>
            <span class="name">{{ c.icon }} {{ translatedTitle(c, locale) }}</span>
            <button class="btn btn-sm" @click="startEdit(c)">{{ t("common.edit") }}</button>
            <button
              class="btn btn-sm btn-ghost"
              style="color: var(--negative)"
              @click="askDelete(c.id)"
            >
              {{ t("common.delete") }}
            </button>
          </template>
        </div>
      </div>
    </main>
    <div v-if="toast" class="toast">{{ toast }}</div>

    <div v-if="deleteTarget !== null" class="overlay" @click.self="deleteTarget = null">
      <div class="sheet-wrap">
        <div class="sheet">
          <button class="close-x" @click="deleteTarget = null">✕</button>
          <h2>{{ t("admin.deleteCategory") }}</h2>
          <p style="font-size: 14px; color: var(--ink-soft); margin-bottom: 14px">
            {{ t("admin.migrateDescription") }}
          </p>
          <div class="field">
            <label>{{ t("admin.migrateTo") }}</label>
            <select v-model.number="migrateTo">
              <option
                v-for="c in categories.filter((x) => x.id !== deleteTarget)"
                :key="c.id"
                :value="c.id"
              >
                {{ c.icon }} {{ translatedTitle(c, locale) }}
              </option>
            </select>
          </div>
          <div class="modal-actions">
            <button class="btn" @click="deleteTarget = null">{{ t("common.cancel") }}</button>
            <button class="btn btn-accent" style="flex: 1" @click="removeCategory">
              {{ t("admin.deleteCategoryButton") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
