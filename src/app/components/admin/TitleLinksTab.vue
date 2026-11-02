<script setup lang="ts">
import { translatedTitle } from "~/utils/format";

const emit = defineEmits<{ error: [msg: string] }>();

const { t, locale } = useI18n();
const { categories, refresh: loadCategories } = useCategories();
const { links, refresh: loadLinks } = useCategoryLinks();

const newLinkTitle = ref("");
const newLinkCategory = ref(0);
const editingLinkId = ref<number | null>(null);
const editLinkTitle = ref("");
const editLinkCategory = ref(0);
const confirmLinkId = ref<number | null>(null);
let confirmTimer: ReturnType<typeof setTimeout> | null = null;

const linkRows = computed(() =>
  links.value.map((l) => {
    const cat = categories.value.find((c) => c.id === l.categoryId);
    return { ...l, categoryLabel: cat ? `${cat.icon} ${translatedTitle(cat, locale.value)}` : "—" };
  }),
);

onMounted(async () => {
  await Promise.all([loadCategories(), loadLinks()]);
  newLinkCategory.value = categories.value[0]?.id ?? 0;
});

onBeforeUnmount(() => {
  if (confirmTimer) clearTimeout(confirmTimer);
});

function linkError(e: unknown, fallback: string): string {
  const code = (e as { data?: { message?: string } })?.data?.message;
  const messages: Record<string, string> = {
    link_exists: t("admin.linkExists"),
    link_title_invalid: t("admin.linkTitleInvalid"),
    link_category_invalid: t("admin.linkCategoryInvalid"),
    link_limit_reached: t("admin.linkLimit"),
  };
  return (code && messages[code]) || fallback;
}

async function addLink() {
  const title = newLinkTitle.value.trim();
  if (!title) return;
  try {
    await $fetch("/api/category-links", {
      method: "POST",
      body: { title, categoryId: newLinkCategory.value },
    });
    newLinkTitle.value = "";
    await loadLinks();
  } catch (e: unknown) {
    emit("error", linkError(e, t("admin.couldntAddLink")));
  }
}

function startEditLink(l: { id: number; title: string; categoryId: number }) {
  editingLinkId.value = l.id;
  editLinkTitle.value = l.title;
  editLinkCategory.value = l.categoryId;
}

async function saveLink(id: number) {
  try {
    await $fetch(`/api/category-links/${id}`, {
      method: "PATCH",
      body: { title: editLinkTitle.value, categoryId: editLinkCategory.value },
    });
    editingLinkId.value = null;
    await loadLinks();
  } catch (e: unknown) {
    emit("error", linkError(e, t("admin.couldntUpdateLink")));
  }
}

/** Two-click delete: the first click arms, the second (within 3s) confirms. */
function removeLink(id: number) {
  if (confirmLinkId.value !== id) {
    confirmLinkId.value = id;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      confirmLinkId.value = null;
    }, 3000);
    return;
  }
  confirmLinkId.value = null;
  void (async () => {
    try {
      await $fetch(`/api/category-links/${id}`, { method: "DELETE" });
      await loadLinks();
    } catch (e: unknown) {
      emit("error", linkError(e, t("admin.couldntDeleteLink")));
    }
  })();
}
</script>

<template>
  <div>
    <div class="section-label">{{ t("admin.addLink") }}</div>
    <p class="profile-description">{{ t("admin.linkHint") }}</p>
    <div class="row2">
      <div class="field">
        <label>{{ t("admin.linkTitle") }}</label>
        <input
          v-model="newLinkTitle"
          type="text"
          maxlength="80"
          :placeholder="t('admin.linkTitlePlaceholder')"
          @keyup.enter="addLink"
        />
      </div>
      <div class="field">
        <label>{{ t("admin.linkCategory") }}</label>
        <select v-model.number="newLinkCategory">
          <option v-for="c in categories" :key="c.id" :value="c.id">
            {{ c.icon }} {{ translatedTitle(c, locale) }}
          </option>
        </select>
      </div>
    </div>
    <button class="btn btn-sm btn-accent" style="margin-bottom: 18px" @click="addLink">
      {{ t("admin.addLinkButton") }}
    </button>
    <div class="section-label">{{ t("admin.existingLinks") }}</div>
    <div v-if="!linkRows.length" class="empty" style="padding: 30px 10px">
      <p>{{ t("admin.noLinks") }}</p>
    </div>
    <div v-for="l in linkRows" :key="l.id" class="balance-row">
      <template v-if="editingLinkId === l.id">
        <input v-model="editLinkTitle" type="text" maxlength="80" style="flex: 1; min-width: 0" />
        <select v-model.number="editLinkCategory" style="flex: 1; min-width: 0">
          <option v-for="c in categories" :key="c.id" :value="c.id">
            {{ c.icon }} {{ translatedTitle(c, locale) }}
          </option>
        </select>
        <button class="btn btn-sm btn-accent" @click="saveLink(l.id)">{{ t("common.save") }}</button>
        <button class="btn btn-sm" @click="editingLinkId = null">{{ t("common.cancel") }}</button>
      </template>
      <template v-else>
        <span class="name">{{ l.title }}</span>
        <span style="font-size: 13px; color: var(--ink-soft)">{{ l.categoryLabel }}</span>
        <button class="btn btn-sm" @click="startEditLink(l)">{{ t("common.edit") }}</button>
        <button
          class="btn btn-sm btn-ghost"
          style="color: var(--negative)"
          @click="removeLink(l.id)"
        >
          {{ confirmLinkId === l.id ? t("admin.confirmDeleteLink") : t("common.delete") }}
        </button>
      </template>
    </div>
  </div>
</template>
