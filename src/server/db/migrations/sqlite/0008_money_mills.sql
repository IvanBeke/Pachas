-- Money is now stored in mills (thousandths) instead of cents, so every stored
-- amount is multiplied by 10. Shares and settlement allocations scale with the
-- amounts they belong to, so every expense still sums exactly. This runs once
-- (the migration journal) and cannot be undone: take a backup before upgrading.
UPDATE `expenses` SET `amount` = `amount` * 10, `amount_base` = `amount_base` * 10;--> statement-breakpoint
UPDATE `expense_splits` SET `amount` = `amount` * 10;--> statement-breakpoint
UPDATE `settlements` SET `amount` = `amount` * 10;--> statement-breakpoint
UPDATE `settlement_allocations` SET `amount` = `amount` * 10;--> statement-breakpoint
UPDATE `recurring_expenses` SET
  `amount` = `amount` * 10,
  `amount_base` = `amount_base` * 10,
  `splits` = (
    SELECT json_group_object(j.`key`, j.`value` * 10) FROM json_each(`recurring_expenses`.`splits`) j
  );
