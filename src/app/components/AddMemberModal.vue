<script setup lang="ts">
import type { Profile } from "~/utils/format";

const { t } = useI18n();

const props = defineProps<{ groupId: string; groupName: string; existing: string[] }>();
const emit = defineEmits<{ close: []; added: []; error: [msg: string] }>();

const search = ref("");
const hits = ref<Profile[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = search.value.trim();
    // The server ignores shorter queries, so don't send them.
    if (q.length < 3) {
      hits.value = [];
      return;
    }
    try {
      const list = await $fetch<Profile[]>(
        "/api/users/search?q=" + encodeURIComponent(q),
      );
      hits.value = list.filter((p) => props.existing.indexOf(p.id) === -1);
    } catch {
      // ignore
    }
  }, 250);
});

async function pick(id: string) {
  try {
    await $fetch(`/api/groups/${props.groupId}/members`, {
      method: "POST",
      body: { userId: id },
    });
    emit("added");
  } catch (e: unknown) {
    emit("error", (e as Error)?.message || t("addMemberModal.couldntAdd"));
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet-wrap">
      <div class="sheet">
        <button class="close-x" @click="emit('close')">✕</button>
        <h2>{{ t("addMemberModal.title", { name: groupName }) }}</h2>
        <div class="field">
          <label>{{ t("addMemberModal.search") }}</label>
          <input
            v-model="search"
            type="text"
            :placeholder="t('addMemberModal.searchPlaceholder')"
            autocomplete="off"
          />
          <div v-if="hits.length" class="search-results">
            <div
              v-for="p in hits"
              :key="p.id"
              class="search-hit"
              @click="pick(p.id)"
            >
              {{ p.name || t("addMemberModal.someone") }}
              <span style="color: var(--ink-faint)">@{{ p.username }}</span>
            </div>
          </div>
          <div
            v-else
            style="font-size: 12.5px; color: var(--ink-faint); margin-top: 8px"
          >
            {{ t("addMemberModal.startTyping") }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
