<script setup lang="ts">
import {
  fmt,
  translatedTitle,
  type Group,
  type Profile,
} from "~/utils/format";
import { useProfiles } from "~/composables/useGroups";

const { t, locale } = useI18n();

const props = defineProps<{ group: Group; me: Profile }>();
const emit = defineEmits<{ close: []; imported: []; error: [msg: string] }>();

const { nameOf } = useProfiles();

const step = ref<"input" | "matchMembers" | "matchCategories" | "preview">("input");
const csvMembers = ref<string[]>([]);
const csvCategories = ref<string[]>([]);
const memberMapping = ref<Record<string, string>>({});
const categoryMapping = ref<Record<string, string>>({});
const sample = ref<
  { date: string; title: string; category: string; amount: number; currency: string }[]
>([]);
const total = ref(0);
const skipped = ref(0);
const totalAmount = ref(0);
const { categories, load: loadCategories } = useCategories();
const importing = ref(false);
const fileName = ref("");
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const file = ref<File | null>(null);

onMounted(loadCategories);

// The server owns parsing: the file is uploaded once for analysis and again
// to commit, so amounts are never taken on trust from the browser.
async function analyze(f: File) {
  file.value = f;
  fileName.value = f.name;
  const fd = new FormData();
  fd.append("file", f);
  const res = await $fetch<{
    members: string[];
    categories: string[];
    total: number;
    skipped: number;
    totalAmount: number;
    sample: typeof sample.value;
  }>(`/api/groups/${props.group.id}/import/analyze`, { method: "POST", body: fd });

  csvMembers.value = res.members;
  csvCategories.value = res.categories;
  total.value = res.total;
  skipped.value = res.skipped;
  totalAmount.value = res.totalAmount;
  sample.value = res.sample;

  // Auto-match by name, claiming each group member at most once — two CSV
  // columns can share a name, and they must not both land on one person.
  const taken = new Set<string>();
  for (const m of res.members) {
    const match = props.group.memberIds.find(
      (id) => !taken.has(id) && nameOf(id, props.me) === m,
    );
    memberMapping.value[m] = match || "";
    if (match) taken.add(match);
  }
  for (const c of res.categories) {
    const match = categories.value.find((cat) => cat.title === c);
    categoryMapping.value[c] = match ? String(match.id) : "";
  }

  if (skipped.value) emit("error", t("importModal.errorBadRows", { count: skipped.value }));
  step.value = "matchMembers";
}

async function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) {
    try {
      await analyze(f);
    } catch (e: unknown) {
      emit("error", importError(e));
    }
  }
}

async function onDrop(e: DragEvent) {
  dragOver.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) {
    try {
      await analyze(f);
    } catch (e: unknown) {
      emit("error", importError(e));
    }
  }
}

function importError(e: unknown): string {
  // The server throws createError({ message: "<i18n key>", data: { params } }),
  // so the key is top level and interpolation params sit in `data`.
  const err = e as { message?: string; data?: Record<string, unknown> };
  const code = err?.message || "";
  const key = `importModal.${code}`;
  if (code && t(key) !== key) return t(key, err?.data || {});
  return t("importModal.couldntImport");
}

// A group member can only answer for one CSV member. Mapping two CSV
// members onto the same person would quietly double their share, so those
// options are disabled once taken.
function isMemberTaken(csvMember: string, groupMemberId: string): boolean {
  return csvMembers.value.some(
    (other) => other !== csvMember && memberMapping.value[other] === groupMemberId,
  );
}

function confirmMemberMatch() {
  for (const m of csvMembers.value) {
    if (!memberMapping.value[m]) {
      emit("error", t("importModal.errorUnmatchedMember"));
      return;
    }
  }
  step.value = "matchCategories";
}

function confirmCategoryMatch() {
  for (const c of csvCategories.value) {
    if (!categoryMapping.value[c]) {
      emit("error", t("importModal.errorUnmatchedCategory"));
      return;
    }
  }
  step.value = "preview";
}

async function confirmImport() {
  if (!file.value) return;
  importing.value = true;
  try {
    const fd = new FormData();
    fd.append("file", file.value);
    fd.append("memberMapping", JSON.stringify(memberMapping.value));
    fd.append("categoryMapping", JSON.stringify(categoryMapping.value));
    await $fetch(`/api/groups/${props.group.id}/import`, { method: "POST", body: fd });
    fileName.value = "";
    if (fileInput.value) fileInput.value.value = "";
    file.value = null;
    emit("imported");
  } catch (e: unknown) {
    emit("error", importError(e));
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet-wrap" style="position: relative">
      <div class="sheet">
        <button class="close-x" @click="emit('close')">✕</button>

        <template v-if="step === 'input'">
          <h2>{{ t("importModal.title") }}</h2>
          <p style="font-size: 14px; color: var(--ink-soft); margin-bottom: 14px">
            {{ t("importModal.instructions") }}
          </p>
          <div
            class="drop-zone"
            :class="{ 'drag-over': dragOver }"
            @click="fileInput?.click()"
            @dragover.prevent="dragOver = true"
            @dragleave="dragOver = false"
            @drop.prevent="onDrop"
          >
            <input
              ref="fileInput"
              type="file"
              accept=".csv,text/csv"
              style="display: none"
              @change="onFileChange"
            />
            <div style="font-size: 32px; margin-bottom: 8px">📄</div>
            <div v-if="fileName" style="font-weight: 600; font-size: 14px">{{ fileName }}</div>
            <div v-else style="font-size: 14px; color: var(--ink-soft)">
              {{ t("importModal.dropHint") }}
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn" @click="emit('close')">{{ t("importModal.cancel") }}</button>
          </div>
        </template>

        <template v-else-if="step === 'matchMembers'">
          <h2>{{ t("importModal.matchMembers") }}</h2>
          <p style="font-size: 14px; color: var(--ink-soft); margin-bottom: 14px">
            {{ t("importModal.foundExpenses", { count: total }) }}
          </p>
          <div v-for="m in csvMembers" :key="m" class="field" style="margin-bottom: 10px">
            <label>{{ m }}</label>
            <select v-model="memberMapping[m]">
              <option value="">{{ t("importModal.selectMember") }}</option>
              <option
                v-for="id in group.memberIds"
                :key="id"
                :value="id"
                :disabled="isMemberTaken(m, id)"
              >
                {{ nameOf(id, me) }}{{ isMemberTaken(m, id) ? " — " + t("importModal.alreadyMatched") : "" }}
              </option>
            </select>
          </div>
          <div class="modal-actions">
            <button class="btn" @click="step = 'input'">{{ t("importModal.back") }}</button>
            <button class="btn btn-accent" style="flex: 1" @click="confirmMemberMatch">
              {{ t("importModal.next") }}
            </button>
          </div>
        </template>

        <template v-else-if="step === 'matchCategories'">
          <h2>{{ t("importModal.matchCategories") }}</h2>
          <p style="font-size: 14px; color: var(--ink-soft); margin-bottom: 14px">
            {{ t("importModal.matchCategoriesHint") }}
          </p>
          <div v-for="c in csvCategories" :key="c" class="field" style="margin-bottom: 10px">
            <label>{{ c }}</label>
            <select v-model="categoryMapping[c]">
              <option value="">{{ t("importModal.selectCategory") }}</option>
              <option v-for="cat in categories" :key="cat.id" :value="String(cat.id)">
                {{ cat.icon }} {{ translatedTitle(cat, locale) }}
              </option>
            </select>
          </div>
          <div class="modal-actions">
            <button class="btn" @click="step = 'matchMembers'">{{ t("importModal.back") }}</button>
            <button class="btn btn-accent" style="flex: 1" @click="confirmCategoryMatch">
              {{ t("importModal.next") }}
            </button>
          </div>
        </template>

        <template v-else>
          <h2>{{ t("importModal.preview") }}</h2>
          <p style="font-size: 14px; color: var(--ink-soft); margin-bottom: 14px">
            {{ t("importModal.previewHint", { count: total }) }}
          </p>
          <div class="import-total">
            {{ t("importModal.totalAmount", { amount: fmt(totalAmount, group.baseCurrency) }) }}
          </div>
          <div style="max-height: 240px; overflow-y: auto">
            <div
              v-for="(exp, i) in sample"
              :key="i"
              style="padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 13px"
            >
              <b>{{ exp.date }}</b> — {{ exp.title }}
              <span style="color: var(--ink-faint)">
                · {{ fmt(exp.amount, exp.currency) }}
              </span>
            </div>
          </div>
          <p v-if="total > sample.length" style="font-size: 12px; color: var(--ink-faint)">
            {{ t("importModal.andMore", { count: total - sample.length }) }}
          </p>
          <div class="modal-actions">
            <button class="btn" @click="step = 'matchCategories'">{{ t("importModal.back") }}</button>
            <button class="btn btn-accent" style="flex: 1" :disabled="importing" @click="confirmImport">
              {{ importing ? t("importModal.importing") : t("importModal.confirm") }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drop-zone {
  border: 2px dashed var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 40px 20px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  margin-bottom: 14px;
}
.drop-zone:hover,
.drop-zone.drag-over {
  border-color: var(--accent);
  background: var(--accent-bg);
}
.import-total {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 10px;
  font-variant-numeric: tabular-nums;
}
</style>
