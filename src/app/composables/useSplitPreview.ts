import type { Ref } from "vue";
import { fmt } from "~/utils/format";
import {
  hasSplitPreview,
  previewSplits,
  type RoundingRing,
  type SplitType,
} from "~/utils/splits";

/**
 * The per-person amount shown beside the split inputs of an expense form.
 *
 * Previews use the shared split code (see `previewSplits`), so they match what
 * the server will store. They are only previews: nothing here is ever sent.
 */
export function useSplitPreview(form: {
  splitType: Ref<SplitType>;
  /** The amount typed for the expense, in the expense currency. */
  amount: Ref<number>;
  currency: Ref<string>;
  participants: Ref<string[]>;
  memberIds: Ref<string[]>;
  splitValues: Ref<Record<string, number>>;
  /** Whose turn it is to get a leftover cent, as the server will see it. */
  rounding: Ref<RoundingRing>;
  /** What an input holds before the user has typed in it. */
  defaultValue: (id: string) => number;
}) {
  /** Equal, percent and shares show an amount; exact is typed directly. */
  const showPreview = computed(() => hasSplitPreview(form.splitType.value));

  const shares = computed(() => {
    const splitType = form.splitType.value;
    if (!hasSplitPreview(splitType)) return {};
    const values: Record<string, number> = {};
    for (const id of form.participants.value) {
      values[id] = Number(form.splitValues.value[id] ?? form.defaultValue(id)) || 0;
    }
    return previewSplits({
      splitType,
      amount: form.amount.value,
      participants: form.participants.value,
      memberIds: form.memberIds.value,
      values,
      rounding: form.rounding.value,
    });
  });

  /** "—" for someone who is not taking part. */
  function previewText(id: string): string {
    const value = shares.value[id];
    return value === undefined ? "—" : fmt(value, form.currency.value);
  }

  return { showPreview, previewText };
}
