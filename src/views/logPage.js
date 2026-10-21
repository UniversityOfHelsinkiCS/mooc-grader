const { escapeHtml, externalLink, layout } = require("./html")
const { allCourses, findTab, findCourseByExercise } = require("../config/tabs")
const { AUTO_GRADER_ACTOR } = require("../services/autoGrader")

const ACTION_LABELS = {
  full_points: "Full points",
  zero_points: "Zero points",
  reset: "Reset",
  approve_pr: "Approve PR",
  completion: "Completion",
  cheater_confirm: "Cheater",
  cheater_dismiss: "Honest",
  invite_accept: "Accept invitation",
  invite_decline: "Remove invitation",
  invite_accept_all: "Accept all invitations",
  invite_decline_expired: "Remove expired invitations",
  auto_grade_run: "Scheduled run",
}

const FILTER_PARAMS = {
  actor: "actor",
  action: "action",
  tabId: "tab",
  userId: "user",
  failed: "failed",
  from: "from",
  to: "to",
}

// "2026-10-20 12:14:02", Finnish time
const TIME_FORMAT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Helsinki",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

const DATE_FORMAT = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" })

// "YYYY-MM-DD" in Finnish time, days days before now
function finnishDate(now, days = 0) {
  return DATE_FORMAT.format(new Date(now.getTime() - days * 24 * 60 * 60 * 1000))
}

function isDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
}

// The page URL with the filters, e.g. to add one filter or to page
function logUrl(basePath, filters, extra = {}) {
  const params = new URLSearchParams()
  for (const [key, param] of Object.entries(FILTER_PARAMS)) {
    const value = { ...filters, ...extra }[key]
    if (value) params.set(param, value === true ? "1" : value)
  }
  if (extra.before) params.set("before", extra.before)
  const query = params.toString()
  return `${basePath}/log${query ? `?${query}` : ""}`
}

// Reads the filters of the page from its query string; unknown values are
// dropped, as they could match nothing
function parseLogQuery(query) {
  const text = (value) =>
    typeof value === "string" && value.length > 0 && value.length <= 100 ? value : null
  const before = /^[1-9]\d{0,17}$/.test(query.before ?? "") ? query.before : null
  return {
    before,
    filters: {
      actor: text(query.actor),
      action: ACTION_LABELS[query.action] ? query.action : null,
      tabId: text(query.tab),
      userId: text(query.user),
      failed: query.failed === "1",
      from: isDate(query.from) ? query.from : null,
      to: isDate(query.to) ? query.to : null,
    },
  }
}

// A value that filters the page by itself when clicked
function filterLink(basePath, filters, key, value, content = escapeHtml(value)) {
  return `<a href="${escapeHtml(logUrl(basePath, filters, { [key]: value }))}">${content}</a>`
}

// Long ids are shortened, the whole id is in the tooltip
function shortId(id) {
  return `<span class="log-id" title="${escapeHtml(id)}">${escapeHtml(id.slice(0, 8))}</span>`
}

function courseName(tabs, row) {
  const course =
    (row.exercise_id && findCourseByExercise(tabs, row.exercise_id)) ||
    allCourses(tabs).find((item) => item.courseId === row.course_id)
  if (course) return escapeHtml(course.name)
  const completionTab = tabs.find((tab) => tab.completion?.courseInstanceId === row.course_id)
  if (completionTab) return `${escapeHtml(completionTab.name)} completions`
  return row.course_id ? shortId(row.course_id) : ""
}

// Postgres jsonb does not keep the order of the keys, so the known ones are
// shown in the order of a run: invitations first, failures last
const DETAIL_ORDER = ["invitations", "approved", "full_points", "reset", "failed", "not_loaded"]
const detailRank = (key) => (DETAIL_ORDER.includes(key) ? DETAIL_ORDER.indexOf(key) : -1)

function renderDetails(details) {
  if (!details) return ""
  return Object.entries(details)
    .sort(([a], [b]) => detailRank(a) - detailRank(b))
    .map(([key, value]) => {
      const shown =
        typeof value === "string" && /^https:\/\//.test(value)
          ? externalLink(value)
          : escapeHtml(Array.isArray(value) ? value.join(", ") || "-" : value)
      return `<span class="log-detail">${escapeHtml(key)}:</span> ${shown}`
    })
    .join("<br>")
}

function renderLogRow(row, tabs, basePath, filters) {
  const tab = row.tab_id
    ? filterLink(basePath, filters, "tabId", row.tab_id, escapeHtml(findTab(tabs, row.tab_id)?.name ?? row.tab_id))
    : ""
  // The scheduled grading stands out from the actions people did
  const actor = !row.actor_uid
    ? `<span class="none">unknown</span>`
    : row.actor_uid === AUTO_GRADER_ACTOR
      ? filterLink(basePath, filters, "actor", row.actor_uid, `<span class="badge log-cron">${escapeHtml(row.actor_uid)}</span>`)
      : filterLink(basePath, filters, "actor", row.actor_uid)
  const action = filterLink(basePath, filters, "action", row.action, escapeHtml(ACTION_LABELS[row.action] ?? row.action))
  const student = row.target_user_id
    ? filterLink(basePath, filters, "userId", row.target_user_id, shortId(row.target_user_id))
    : ""
  const answer = row.target_answer_id ? shortId(row.target_answer_id) : ""
  const result = row.ok
    ? `<span class="grade-ok">ok</span>`
    : `<span class="grade-fail">failed${row.error ? `: ${escapeHtml(row.error)}` : ""}</span>`
  // A scheduled run is logged after its actions, so newest first its row
  // starts the group of them; the border separates the runs
  const rowClass = row.action === "auto_grade_run" ? ' class="log-run"' : ""
  return `<tr${rowClass}><td class="log-time">${escapeHtml(TIME_FORMAT.format(new Date(row.created_at)))}</td><td>${actor}</td><td>${action}</td><td>${tab}</td><td>${courseName(tabs, row)}</td><td>${student}</td><td>${answer}</td><td>${renderDetails(row.details)}</td><td>${result}</td></tr>`
}

// Quick ranges ending today; the selected one is shown in bold
function renderRangeLinks(filters, basePath, now) {
  const today = finnishDate(now)
  const ranges = [
    ["today", 0],
    ["last 7 days", 6],
    ["last 30 days", 29],
  ]
  const links = ranges.map(([label, days]) => {
    const from = finnishDate(now, days)
    const selected = filters.from === from && (!filters.to || filters.to === today)
    const link = `<a href="${escapeHtml(logUrl(basePath, { ...filters, from, to: null }))}">${label}</a>`
    return selected ? `<strong>${link}</strong>` : link
  })
  const all = !filters.from && !filters.to
  const allLink = `<a href="${escapeHtml(logUrl(basePath, { ...filters, from: null, to: null }))}">all time</a>`
  return `<p class="log-ranges">${links.join(" · ")} · ${all ? `<strong>${allLink}</strong>` : allLink}</p>`
}

// The filters apply as soon as one changes (public/logPage.js); without the
// script, Enter in a field applies them. Filters in use are highlighted.
function renderFilterForm(tabs, filters, basePath) {
  const active = (on) => (on ? ' class="active"' : "")
  const option = (value, label, selected) =>
    `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`
  const actions = Object.entries(ACTION_LABELS)
    .map(([value, label]) => option(value, label, filters.action === value))
    .join("")
  const tabOptions = tabs.map((tab) => option(tab.id, tab.name, filters.tabId === tab.id)).join("")
  const input = (name, value, placeholder, type = null) =>
    `<input${type ? ` type="${type}"` : ""} name="${name}" value="${escapeHtml(value ?? "")}"${placeholder ? ` placeholder="${placeholder}"` : ""}${active(value)}>`
  const anyActive = Object.keys(FILTER_PARAMS).some((key) => filters[key])
  const clear = anyActive
    ? ` <a href="${escapeHtml(basePath)}/log">clear filters</a>`
    : ""
  return `<form class="log-filters" method="get" action="${escapeHtml(basePath)}/log">
<span class="log-filters-label">Show only:</span>
${input("actor", filters.actor, "admin uid")}
<select name="action"${active(filters.action)}>${option("", "all actions", !filters.action)}${actions}</select>
<select name="tab"${active(filters.tabId)}>${option("", "all tabs", !filters.tabId)}${tabOptions}</select>
${input("user", filters.userId, "student user id")}
<label>from ${input("from", filters.from, null, "date")}</label>
<label>to ${input("to", filters.to, null, "date")}</label>
<label${active(filters.failed)}><input type="checkbox" name="failed" value="1"${filters.failed ? " checked" : ""}> failed only</label>${clear}
</form>`
}

// rows: newest first; when there are limit of them, the page links to the
// older ones. enabled: false when no database is configured
function renderLogPage(
  rows,
  { tabs, filters, limit, enabled = true, basePath = "", now = new Date() },
) {
  const back = `<p><a href="${escapeHtml(basePath)}/">&larr; Overview</a></p>`
  if (!enabled) {
    return layout({
      title: "Action log",
      basePath,
      body: `${back}<h1>Action log</h1><p class="none">The action log is off: DATABASE_URL is not set.</p>`,
    })
  }
  const table =
    rows.length === 0
      ? `<p class="none">No actions.</p>`
      : `<table class="log"><thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Tab</th><th>Course</th><th>Student</th><th>Answer</th><th>Details</th><th>Result</th></tr></thead><tbody>${rows
          .map((row) => renderLogRow(row, tabs, basePath, filters))
          .join("")}</tbody></table>`
  const older =
    rows.length === limit
      ? `<p><a href="${escapeHtml(logUrl(basePath, filters, { before: rows.at(-1).id }))}">Older &rarr;</a></p>`
      : ""
  return layout({
    title: "Action log",
    basePath,
    bodyClass: "compact",
    body: `${back}<h1>Action log</h1>${renderRangeLinks(filters, basePath, now)}${renderFilterForm(tabs, filters, basePath)}${table}${older}
  <script src="${escapeHtml(basePath)}/static/logPage.js"></script>`,
  })
}

module.exports = { renderLogPage, parseLogQuery }
