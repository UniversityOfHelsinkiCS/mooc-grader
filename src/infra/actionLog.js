// Append-only log of the actions done with the buttons: who did what, in
// which course, to whom and when. One row per action; bulk buttons that go
// through answers one at a time produce one row per answer.
//
// The table is not created by the app; it is expected to exist, see
// db/schema.sql

const COLUMNS = [
  "actor_uid",
  "action",
  "tab_id",
  "course_id",
  "exercise_id",
  "target_user_id",
  "target_answer_id",
  "details",
  "ok",
  "error",
]

const INSERT = `INSERT INTO action_log (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(
  (_, i) => `$${i + 1}`,
).join(", ")})`

// One fixed query for every combination of filters: a filter whose value
// is null (or false for $6) matches every row. $7 and $8 are dates, both
// included, as whole days in Finnish time.
const RECENT = `
  SELECT * FROM action_log
  WHERE ($1::bigint IS NULL OR id < $1)
    AND ($2::text IS NULL OR actor_uid = $2)
    AND ($3::text IS NULL OR action = $3)
    AND ($4::text IS NULL OR tab_id = $4)
    AND ($5::text IS NULL OR target_user_id = $5)
    AND (NOT $6::boolean OR NOT ok)
    AND ($7::date IS NULL OR created_at >= $7::date::timestamp AT TIME ZONE 'Europe/Helsinki')
    AND ($8::date IS NULL OR created_at < ($8::date + 1)::timestamp AT TIME ZONE 'Europe/Helsinki')
  ORDER BY id DESC
  LIMIT $9
`

// db: anything with query(text, values), e.g. a pg Pool
function createActionLog({ db }) {
  // A failing log write must never fail the action itself, so the returned
  // promise never rejects and callers need not wait for it
  async function log(entry) {
    const row = {
      ...entry,
      // pg would send an array as a Postgres array, not as JSON
      details: entry.details ? JSON.stringify(entry.details) : null,
      ok: !!entry.ok,
    }
    try {
      await db.query(
        INSERT,
        COLUMNS.map((column) => row[column] ?? null),
      )
    } catch (err) {
      console.error("Action log write failed:", err.message)
    }
  }

  // Newest first, at most limit rows older than the row id before.
  // filters: { actor, action, tabId, userId, failed, from, to }, all
  // optional; from and to are dates "YYYY-MM-DD" in Finnish time, both
  // included
  async function recent({ limit = 100, before = null, filters = {} } = {}) {
    const { rows } = await db.query(RECENT, [
      before ?? null,
      filters.actor ?? null,
      filters.action ?? null,
      filters.tabId ?? null,
      filters.userId ?? null,
      !!filters.failed,
      filters.from ?? null,
      filters.to ?? null,
      limit,
    ])
    return rows
  }

  return { enabled: true, log, recent }
}

// Used when no database is configured, e.g. in local development
const noActionLog = { enabled: false, log: async () => {}, recent: async () => [] }

module.exports = { createActionLog, noActionLog }
