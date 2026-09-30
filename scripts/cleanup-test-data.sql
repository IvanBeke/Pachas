-- Removes leftovers from the API contract suite (tests/api.*.test.ts).
--
-- The suite cleans up its own expenses, but there is no DELETE /groups/:id
-- route and no self-deleting user endpoint, so its groups and throwaway
-- accounts persist. Run this after running the API tests:
--
--   docker compose exec -T db psql -U pachas pachas -v ON_ERROR_STOP=1 -f - < scripts/cleanup-test-data.sql
--
-- Safe to re-run: it only matches the suite's own naming patterns
-- (groups named `__...`, users named own*/oth*/str* plus a run id).

BEGIN;

-- Expenses first; expense_splits cascade on delete.
DELETE FROM expenses
 WHERE group_id IN (SELECT id FROM groups WHERE name LIKE '\_\_%');

-- Sessions reference users, so clear them before the users.
DELETE FROM app_sessions
 WHERE user_id IN (
   SELECT id FROM users WHERE username ~ '^(own|oth|str)[a-z0-9]{6,}$'
 );

DELETE FROM groups WHERE name LIKE '\_\_%';
DELETE FROM users WHERE username ~ '^(own|oth|str)[a-z0-9]{6,}$';

COMMIT;
