/**
 * Client-side view of the split maths.
 *
 * This is a re-export of `shared/splits.ts` — the server runs the exact same
 * code and is authoritative. The client uses this ONLY to render a live
 * preview; it never sends computed amounts to the API. See AGENTS.md.
 */
export {
  assignRemainder,
  computeSplits,
  itemsTotals,
  round2,
  splitsToInputValues,
  sumSplits,
  type ExpenseItem,
  type SplitFailure,
  type SplitInput,
  type SplitResult,
  type SplitType,
} from "../../shared/splits";
