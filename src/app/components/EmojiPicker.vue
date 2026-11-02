<script setup lang="ts">
import {
  EMOJI_GROUP_ICONS,
  EMOJI_GROUP_IDS,
  loadEmojiGroups,
  searchEmojis,
  type EmojiGroup,
  type EmojiGroupId,
} from "~/utils/emoji-data";

const props = withDefaults(defineProps<{ modelValue: string; disabled?: boolean }>(), {
  disabled: false,
});
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const { t } = useI18n();

const open = ref(false);
const query = ref("");
const activeGroup = ref<EmojiGroupId>("smileys");
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);

/** Searches can match most of the set; rendering a few hundred buttons is plenty. */
const RESULT_LIMIT = 300;

const groups = ref<EmojiGroup[]>([]);
const loadFailed = ref(false);

const results = computed(() =>
  query.value.trim() ? searchEmojis(groups.value, query.value, RESULT_LIMIT) : null,
);
const visible = computed(
  () =>
    results.value ??
    groups.value.find((g) => g.id === activeGroup.value)?.emojis ??
    [],
);

function openPicker() {
  if (props.disabled) return;
  query.value = "";
  loadFailed.value = false;
  open.value = true;
  loadEmojiGroups()
    .then((loaded) => {
      groups.value = loaded;
      const current = loaded.find((g) => g.emojis.some((x) => x.e === props.modelValue));
      if (current) activeGroup.value = current.id;
    })
    .catch(() => {
      loadFailed.value = true;
    });
  void nextTick(() => {
    // On touch devices focusing the search box would raise the keyboard over the grid.
    const touch = window.matchMedia("(pointer: coarse)").matches;
    (touch ? panel.value : searchInput.value)?.focus();
  });
}

function close() {
  open.value = false;
  trigger.value?.focus();
}

function pick(emoji: string) {
  emit("update:modelValue", emoji);
  close();
}
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="emoji-trigger"
    :disabled="disabled"
    aria-haspopup="dialog"
    :aria-label="t('emojiPicker.open')"
    :title="t('emojiPicker.open')"
    @click="openPicker"
  >
    {{ modelValue || "🧾" }}
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      class="overlay overlay-compact emoji-overlay"
      @click.self="close"
      @keydown.esc.stop="close"
    >
      <div
        ref="panel"
        class="emoji-panel"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        :aria-label="t('emojiPicker.title')"
      >
        <div class="emoji-head">
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            class="emoji-search"
            autocomplete="off"
            :placeholder="t('emojiPicker.search')"
            :aria-label="t('emojiPicker.search')"
          />
          <button
            type="button"
            class="emoji-close"
            :aria-label="t('emojiPicker.close')"
            @click="close"
          >
            ✕
          </button>
        </div>
        <div class="emoji-tabs" :class="{ muted: results }">
          <button
            v-for="id in EMOJI_GROUP_IDS"
            :key="id"
            type="button"
            class="emoji-tab"
            :class="{ active: !results && activeGroup === id }"
            :aria-label="t(`emojiPicker.groups.${id}`)"
            :title="t(`emojiPicker.groups.${id}`)"
            @click="
              query = '';
              activeGroup = id;
            "
          >
            {{ EMOJI_GROUP_ICONS[id] }}
          </button>
        </div>
        <div class="emoji-grid-wrap">
          <div v-if="loadFailed" class="emoji-empty">{{ t("emojiPicker.loadFailed") }}</div>
          <div v-else-if="!groups.length" class="emoji-empty">{{ t("emojiPicker.loading") }}</div>
          <div v-else-if="!visible.length" class="emoji-empty">{{ t("emojiPicker.empty") }}</div>
          <div v-else class="emoji-grid">
            <button
              v-for="x in visible"
              :key="x.e"
              type="button"
              class="emoji-btn"
              :class="{ current: x.e === modelValue }"
              @click="pick(x.e)"
            >
              {{ x.e }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.emoji-trigger {
  width: 56px;
  height: 44px;
  font-size: 22px;
  line-height: 1;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--bg);
  cursor: pointer;
  font-family: var(--sans);
}
.emoji-trigger:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.emoji-trigger:disabled {
  background: var(--bg-sunken);
  cursor: not-allowed;
  opacity: 0.8;
}
.emoji-overlay {
  z-index: 80;
}
.emoji-panel {
  width: 100%;
  max-width: 400px;
  height: min(480px, 70vh);
  height: min(480px, 70dvh);
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg-elevated);
  border-radius: 20px 20px 0 0;
  padding: 14px 14px calc(env(safe-area-inset-bottom, 0px) + 14px);
  outline: none;
}
@media (min-width: 640px) {
  .emoji-panel {
    border-radius: 18px;
    margin-bottom: 5vh;
  }
}
.emoji-head {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
  align-items: center;
}
.emoji-search {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  background: var(--bg);
  color: var(--ink);
  font-size: 15px;
  font-family: var(--sans);
}
.emoji-search:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.emoji-close {
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: var(--bg-sunken);
  color: var(--ink-soft);
  font-size: 15px;
  cursor: pointer;
}
.emoji-tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid var(--line);
  padding-bottom: 6px;
}
.emoji-tabs.muted {
  opacity: 0.5;
}
.emoji-tab {
  flex: 0 0 auto;
  width: 36px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: none;
  font-size: 18px;
  cursor: pointer;
}
.emoji-tab.active {
  background: var(--accent-bg);
}
.emoji-grid-wrap {
  overflow-y: auto;
  min-height: 0;
  flex: 1;
}
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 2px;
}
.emoji-btn {
  height: 40px;
  border: none;
  border-radius: 8px;
  background: none;
  font-size: 22px;
  cursor: pointer;
}
.emoji-btn:hover,
.emoji-btn:focus-visible {
  background: var(--bg-sunken);
  outline: none;
}
.emoji-btn.current {
  background: var(--accent-bg);
}
.emoji-empty {
  padding: 30px 10px;
  text-align: center;
  font-size: 13.5px;
  color: var(--ink-faint);
}
</style>
