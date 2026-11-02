<script setup lang="ts">
import { translatedTitle, type Category } from "~/utils/format";
import EmojiPicker from "~/components/EmojiPicker.vue";

const emit = defineEmits<{ error: [msg: string] }>();

const { t, locale } = useI18n();
const { categories, refresh: loadCategories } = useCategories();
const { refresh: loadLinks } = useCategoryLinks();

const newTitle = ref("");
const newTitleEn = ref("");
const newIcon = ref("🧾");
const editingId = ref<number | null>(null);
const editTitle = ref("");
const editTitleEn = ref("");
const editIcon = ref("");
const deleteTarget = ref<number | null>(null);
const migrateTo = ref<number | 0>(0);

onMounted(loadCategories);

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
    emit("error", (e as Error)?.message || t("admin.couldntAdd"));
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
    emit("error", (e as Error)?.message || t("admin.couldntUpdate"));
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
    // Links of the deleted category now point at the migration target.
    await Promise.all([loadCategories(), loadLinks()]);
  } catch (e: unknown) {
    emit("error", (e as Error)?.message || t("admin.couldntDelete"));
  }
}
</script>

<template>
  <div>
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
        <EmojiPicker v-model="newIcon" />
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
        <EmojiPicker v-model="editIcon" />
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
