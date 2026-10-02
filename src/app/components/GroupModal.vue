<script setup lang="ts">
import { CURRENCIES, type Profile } from "~/utils/format";

const { t } = useI18n();

const emit = defineEmits<{
  close: [];
  created: [id: string];
  error: [msg: string];
}>();

const emoji = ref("🧾");
const name = ref("");
const currency = ref("EUR");
const search = ref("");
const hits = ref<Profile[]>([]);
const members = ref<Profile[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = search.value.trim();
    if (!q) {
      hits.value = [];
      return;
    }
    try {
      const list = await $fetch<Profile[]>(
        "/api/users/search?q=" + encodeURIComponent(q),
      );
      hits.value = list.filter(
        (p) => !members.value.some((m) => m.id === p.id),
      );
    } catch {
      // ignore
    }
  }, 250);
});

function pick(p: Profile) {
  if (!members.value.some((m) => m.id === p.id))
    members.value.push(p);
  hits.value = [];
  search.value = "";
}

function remove(id: string) {
  members.value = members.value.filter((m) => m.id !== id);
}

async function submit() {
  try {
    const g = await $fetch<{ id: string }>("/api/groups", {
      method: "POST",
      body: {
        name: name.value.trim(),
        baseCurrency: currency.value,
        memberIds: members.value.map((m) => m.id),
        emoji: emoji.value || "🧾",
      },
    });
    emit("created", g.id);
    await navigateTo(`/g/${g.id}`);
  } catch (e: unknown) {
    emit("error", (e as Error)?.message || t("groupModal.couldntCreate"));
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet-wrap">
      <div class="sheet">
        <button class="close-x" @click="emit('close')">✕</button>
        <h2>{{ t("groupModal.title") }}</h2>
        <div class="field">
          <label>{{ t("groupModal.emoji") }}</label>
          <input
            v-model="emoji"
            type="text"
            maxlength="2"
            style="width: 60px; text-align: center; font-size: 18px"
          />
        </div>
        <div class="field">
          <label>{{ t("groupModal.name") }}</label>
          <input
            v-model="name"
            type="text"
            :placeholder="t('groupModal.namePlaceholder')"
          />
        </div>
        <div class="field">
          <label>{{ t("groupModal.currency") }}</label>
          <select v-model="currency">
            <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="field">
          <label>{{ t("groupModal.addPeople") }}</label>
          <input
            v-model="search"
            type="text"
            :placeholder="t('groupModal.searchPlaceholder')"
            autocomplete="off"
          />
          <div v-if="hits.length" class="search-results">
            <div
              v-for="p in hits"
              :key="p.id"
              class="search-hit"
              @click="pick(p)"
            >
              {{ p.name || t("groupModal.someone") }}
              <span style="color: var(--ink-faint)">@{{ p.username }}</span>
            </div>
          </div>
          <div v-if="members.length" class="chiprow">
            <div v-for="p in members" :key="p.id" class="chip">
              {{ p.name || t("groupModal.someone")
              }}<span class="x" @click="remove(p.id)">✕</span>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-block btn-accent" @click="submit">
            {{ t("groupModal.create") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
