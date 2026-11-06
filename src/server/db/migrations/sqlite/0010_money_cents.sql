-- Money goes back to integer cents (2 decimals), undoing 0008. Every stored amount is
-- divided by 10, rounded half up, and anything that still has a third decimal is
-- rounded to the cent first, so no value is truncated:
--   * an expense, settlement or template amount: (x + 5) / 10;
--   * the shares of an expense, the allocations of a settlement and the splits of a
--     recurring template are reallocated so they still sum exactly to their
--     rounded total. The stored shares are the weights: each is floored to cents and the
--     leftover cents go to the largest remainders, so no share moves by a full
--     cent. Exact ties (a half cent between two people) alternate between the lower
--     and the higher user id from one expense to the next, so one person does not
--     always take them.
-- Expenses that are already whole cents come out exactly divided by 10. In groups
-- with a recorded settlement, rounding can move a balance by a few cents and leave a
-- cent-sized residual debt: that is the price of not keeping thousandths.
-- Runs once (the migration journal) and cannot be undone: take a backup first.
CREATE TEMP TABLE `__r_in` AS
SELECT
  'e' AS `kind`, x.`expense_id` AS `owner`, x.`user_id` AS `member`, x.`amount` AS `mills`,
  (e.`amount_base` + 5) / 10 AS `k`,
  DENSE_RANK() OVER (PARTITION BY e.`group_id` ORDER BY e.`created_at`, e.`id`) % 2 AS `parity`
FROM `expense_splits` x
JOIN `expenses` e ON e.`id` = x.`expense_id`
UNION ALL
SELECT
  's', x.`settlement_id`, x.`debtor_id` || '>' || x.`creditor_id`, x.`amount`,
  (s.`amount` + 5) / 10, 0
FROM `settlement_allocations` x
JOIN `settlements` s ON s.`id` = x.`settlement_id`
UNION ALL
SELECT 'r', r.`id`, j.`key`, j.`value`, (r.`amount_base` + 5) / 10, 0
FROM `recurring_expenses` r, json_each(r.`splits`) j;--> statement-breakpoint
CREATE TEMP TABLE `__r_a` AS
SELECT *, SUM(`mills`) OVER (PARTITION BY `kind`, `owner`) AS `s` FROM `__r_in`;--> statement-breakpoint
CREATE TEMP TABLE `__r_b` AS
SELECT *,
  CASE
    WHEN `s` = 10 * `k` THEN `mills` / 10
    WHEN `s` > 0 THEN CAST(`mills` * 1.0 * `k` / `s` - 1e-7 AS INTEGER)
    ELSE 0
  END AS `fl`,
  CASE
    WHEN `s` = 10 * `k` THEN (`mills` % 10) / 10.0
    WHEN `s` > 0 THEN `mills` * 1.0 * `k` / `s` - CAST(`mills` * 1.0 * `k` / `s` - 1e-7 AS INTEGER)
    ELSE 0
  END AS `rem`
FROM `__r_a`;--> statement-breakpoint
CREATE TEMP TABLE `__r_c` AS
SELECT
  `kind`, `owner`, `member`,
  `fl` + CASE
    WHEN ROW_NUMBER() OVER (
      PARTITION BY `kind`, `owner`
      ORDER BY
        `rem` DESC,
        CASE WHEN `parity` = 0 THEN `member` END ASC,
        CASE WHEN `parity` = 1 THEN `member` END DESC
    ) <= `k` - SUM(`fl`) OVER (PARTITION BY `kind`, `owner`) THEN 1
    ELSE 0
  END AS `cents`
FROM `__r_b`;--> statement-breakpoint
UPDATE `expense_splits`
SET `amount` = (
  SELECT c.`cents` FROM `__r_c` c
  WHERE c.`kind` = 'e' AND c.`owner` = `expense_splits`.`expense_id` AND c.`member` = `expense_splits`.`user_id`
);--> statement-breakpoint
UPDATE `settlement_allocations`
SET `amount` = (
  SELECT c.`cents` FROM `__r_c` c
  WHERE c.`kind` = 's' AND c.`owner` = `settlement_allocations`.`settlement_id`
    AND c.`member` = `settlement_allocations`.`debtor_id` || '>' || `settlement_allocations`.`creditor_id`
);--> statement-breakpoint
UPDATE `recurring_expenses`
SET `splits` = (
  SELECT json_group_object(c.`member`, c.`cents`) FROM `__r_c` c
  WHERE c.`kind` = 'r' AND c.`owner` = `recurring_expenses`.`id`
)
WHERE EXISTS (SELECT 1 FROM `__r_c` c WHERE c.`kind` = 'r' AND c.`owner` = `recurring_expenses`.`id`);--> statement-breakpoint
UPDATE `expenses` SET `amount` = (`amount` + 5) / 10, `amount_base` = (`amount_base` + 5) / 10;--> statement-breakpoint
UPDATE `settlements` SET `amount` = (`amount` + 5) / 10;--> statement-breakpoint
UPDATE `recurring_expenses` SET `amount` = (`amount` + 5) / 10, `amount_base` = (`amount_base` + 5) / 10;--> statement-breakpoint
DROP TABLE `__r_c`;--> statement-breakpoint
DROP TABLE `__r_b`;--> statement-breakpoint
DROP TABLE `__r_a`;--> statement-breakpoint
DROP TABLE `__r_in`;
