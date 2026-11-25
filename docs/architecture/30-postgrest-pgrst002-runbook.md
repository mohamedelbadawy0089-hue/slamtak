# Runbook — PostgREST `PGRST002` (schema cache cannot be built)

> **Audience:** project owner, working from the Supabase Dashboard or SQL Editor.
> **Full procedures (Arabic):** `docs/architecture-ar/14-postgrest-pgrst002-runbook-ar.md` — this page is the concise English mirror.
> **Companion tooling:** `supabase/diagnostics/read-only-checks.sql` (read-only checks) and `scripts/supabase-health.mjs` (`npm run check:supabase`).
> **Rule:** every step below is a read, a reversible setting, or a restart. No table drops, no backup restores, no `service_role` key outside a server.

## 1. Symptom

Any `/rest/v1/...` request returns:

```json
{"code":"PGRST002","message":"Could not query the database for the schema cache. Retrying."}
```

and `npm run check:supabase` exits `2`. PostgREST failed the catalog query it needs to build its schema cache, so it refuses every read through the Data API. The application and RLS are not the cause: the failure happens before any policy is evaluated.

## 2. Separate it from look-alikes

| What you see | Code / status | Meaning | First move |
|---|---|---|---|
| Cache cannot be built, auth works | `PGRST002` / `503` | Database likely up; cache query failed or timed out | Continue at §3 |
| PostgREST pool timeout | `PGRST003` / `504` | No connection available for the request | SQL check 2 (sessions) |
| Cannot connect at all | `PGRST000`/`PGRST001` / `503` | DB not accepting connections: restore, upgrade, paused | Dashboard project status |
| Auth and Data API both fail | all requests fail | Project paused/suspended | Restore or Resume |
| Everything `401 Invalid API key` | `401` | Wrong key, not a database fault | Check `public/supabase-config.js` |
| `403` or empty rows | `403` / `[]` | Service healthy, RLS working | Not this runbook; check membership (§6) |

## 3. Measure from outside (no writes)

```bash
npm run check:supabase
```

Exit codes: `0` healthy · `1` configuration missing · `2` PostgREST/`PGRST002` · `3` auth failure (project probably paused) · `4` network.

Measured on 2026-11-25 (project `iksjhjxwphmvthryfeae`): `/auth/v1/health` `200` (GoTrue `v2.198.0`), `/auth/v1/settings` `200`, `OPTIONS /rest/v1/rpc/two_step_verify` `200`, `/storage/v1/...` `400`, while `GET /rest/v1/warehouses?select=id&limit=1` returned `503 · PGRST002` in ~2.5 s with `x-envoy-attempt-count: 6`. That excludes a paused project and confines the fault to the Data API layer.

## 4. Collect evidence (read-only)

**4.1 Logs.** Logs → *Postgres* and *Edge/API*, looking for `canceling statement due to statement timeout`, `too many connections`, `deadlock detected`, or short bursts of `PGRST002`.

**4.2 SQL.** In the SQL Editor (it connects directly, so it works despite `503`), run `supabase/diagnostics/read-only-checks.sql` section by section:

| Section | Checks | Result that indicates the fault |
|---|---|---|
| 1 | Database liveness, `pg_is_in_recovery()` | `in_recovery = true` ⇒ wait, do not change anything |
| 2 | Sessions and `idle in transaction` | Accumulated old sessions ⇒ §5.3 |
| 3 | `authenticator`/`anon`/`authenticated` roles and schema privileges | Missing role or no `USAGE` ⇒ configuration fault, escalate |
| 4 | Size of the `public` catalog | Thousands of objects ⇒ §5.2 |
| 5a / 5b | Invalid views/matviews, `NOT VALID` constraints | Any row ⇒ §5.4 |
| 6 | Ungranted locks | Any row ⇒ §5.4 |
| 7 | Migration tracking table | `null` ⇒ migrations were applied by hand |
| 8a / 8b | Effective `pgrst.*` settings vs schemas that actually exist | Declared name missing from the database ⇒ §5.1 |

## 5. Decision tree

Run only the branch the evidence supports, then verify in §6.

### 5.1 Most likely: `db_schemas` names a schema that does not exist

PostgREST cannot build the cache when `pgrst.db_schemas` references a missing schema (common after dropping a schema from the database but not from Data API settings).

1. Project Settings → **Data API** → *Exposed schemas*: remove the name absent from 8b, then **Save** (a setting change, reversible).
2. If `ALTER ROLE authenticator SET pgrst.db_schemas` was applied manually, the Dashboard no longer manages the list; correct it and reload the config:
   ```sql
   ALTER ROLE authenticator SET pgrst.db_schemas = 'public';
   NOTIFY pgrst, 'reload config';
   ```
   Record the previous value first.
3. If the schema was dropped by mistake and is still needed, recreate it empty to restore service, then restore its objects through a migration.

### 5.2 Cache query times out (large or bloated catalog)

Evidence: `statement timeout` in Postgres logs, or large counts in section 4. Order of action: reload the cache (§6), restart the project (§6), then address bloat (remove abandoned objects, or raise the role timeout after review). Do not change `statement_timeout` before reading the logs.

### 5.3 Connection starvation

Evidence: section 2 shows many `idle in transaction` sessions or a total near the limit. Stop the offending client (a local script, a scheduled function, an ORM with a large pool), and review Connection pooling under Database Settings. Terminating old idle backends is a last resort, decided explicitly after inspecting their `query`.

### 5.4 Invalid object or lock on the catalog

Evidence: rows in 5a/5b/6. Fix through a new migration in `supabase/migrations` (recreate the view, or `ALTER TABLE ... VALIDATE CONSTRAINT`), never through undocumented manual DDL. A long `ALTER TABLE` holding a lock must finish or be cancelled after confirming its owner.

### 5.5 Sections 1–8 are clean and the cache is still broken

The PostgREST process itself is stuck: restart the project (§6). No data or schema change.

## 6. Safe actions, in order

1. **Reload the cache** (SQL Editor; changes no data and no schema):
   ```sql
   NOTIFY pgrst, 'reload schema';
   NOTIFY pgrst, 'reload config';
   ```
2. **Restart the project** — Project Settings → General → **Restart project**. Minutes of downtime, no data loss; rebuilds the cache and clears stuck state.
3. After each step: `npm run check:supabase` must exit `0` (`200/401/403/404`, no `PGRST002`).

## 7. Verify the fix, including membership and role

1. **Service:** `npm run check:supabase` ⇒ `exit=0`.
2. **Code:** `npm run test:auth` ⇒ 17/17, including the test proving `verifySession` queries `client.from('user_warehouses')` and stores `tenant_id`, `warehouse_id` and the real role, plus the test that a failed membership query does not block sign-in.
3. **Browser session**, after a successful two-step sign-in:
   ```js
   JSON.parse(localStorage.getItem('session'))
   ```
   Expect a non-empty `tenant_id`, a non-empty `memberships` array, and the real `role`. **Decisive check:** a user whose database role is `employee` must not read `manager` — `manager` is the default from `user_metadata` and means membership was not fetched.
4. **Direct read with the user session** (public anon key; RLS applies):
   ```js
   const c = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
   const { data: { session } } = await c.auth.getSession();
   await c.from('user_warehouses')
     .select('tenant_id, warehouse_id, is_default, role:roles(name)')
     .eq('user_id', session.user.id)
     .order('created_at', { ascending: true })
     .limit(20);
   ```
   Rows, or an explicit `[]` when no membership exists — never an error.
5. **Match the database** (SQL Editor, read-only):
   ```sql
   select uw.user_id, uw.tenant_id, uw.warehouse_id, uw.is_default, r.name as role
   from public.user_warehouses uw
   left join public.roles r on r.id = uw.role_id
   order by uw.created_at;
   ```
   The user's row must match `localStorage.session`, and `/purchases/invoices` must show that warehouse's data rather than an empty screen (proof that `set_tenant_context` took effect).

## 8. Do not

- Put `service_role` in the browser, in health scripts, or in documentation.
- Drop or recreate `public`, or run undocumented manual DDL outside a migration.
- Restore a backup before the cause is known — it discards newer data for nothing.
- Change `statement_timeout` or pool sizes before reading the section-4 logs.
- Disable RLS or loosen a policy "to test": `PGRST002` is unrelated to policies.

## 9. Escalation

If `PGRST002` persists after §5.1–§5.5 and §6 while sections 1–8 show no cause, open a Supabase support ticket with the `sb-request-id` from the response headers, the output of sections 1–8, and confirmation that *Exposed schemas* lists `public` only and matches the effective setting in 8a. Recreating the project is not a first-line fix: it loses data and URLs.
