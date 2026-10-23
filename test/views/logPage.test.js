const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const { renderLogPage, parseLogQuery } = require("../../src/views/logPage")

const tabs = [
  {
    id: "fs",
    name: "Full stack",
    courses: [{ exerciseId: "ex1", name: "graphql", courseId: "c1" }],
  },
]
const STUDENT = "44444444-4444-4444-8444-444444444444"

function row(fields) {
  return {
    id: 1,
    created_at: new Date("2026-10-20T09:14:02Z"),
    actor_uid: "mluukkai",
    action: "full_points",
    tab_id: null,
    course_id: null,
    exercise_id: null,
    target_user_id: null,
    target_answer_id: null,
    details: null,
    ok: true,
    error: null,
    ...fields,
  }
}

describe("parseLogQuery", () => {
  test("keeps known filters and drops invalid ones", () => {
    assert.deepEqual(
      parseLogQuery({ actor: "mluukkai", action: "reset", tab: "fs", failed: "1", before: "42", from: "2026-10-01", to: "2026-10-20" }),
      {
        before: "42",
        filters: { actor: "mluukkai", action: "reset", tabId: "fs", userId: null, failed: true, from: "2026-10-01", to: "2026-10-20", view: null },
      },
    )
    assert.deepEqual(parseLogQuery({ action: "drop table", before: "-1", actor: ["a", "b"], from: "2026-13-45", to: "yesterday", view: "other" }), {
      before: null,
      filters: { actor: null, action: null, tabId: null, userId: null, failed: false, from: null, to: null, view: null },
    })
    assert.equal(parseLogQuery({ view: "actions" }).filters.view, "actions")
    assert.equal(parseLogQuery({ view: "report" }).filters.view, "report")
  })
})

describe("renderLogPage", () => {
  // Most tests are of the list of the actions; the summary is the default
  const filters = parseLogQuery({ view: "actions" }).filters

  test("shows a row in Finnish time with names from the configuration", () => {
    const html = renderLogPage(
      [
        row({
          action: "reset",
          tab_id: "fs",
          course_id: "c1",
          exercise_id: "ex1",
          target_user_id: STUDENT,
          details: { justification: "<b>tests</b> must pass" },
          ok: false,
          error: "500",
        }),
      ],
      { tabs, filters, limit: 200 },
    )
    assert.ok(html.includes("2026-10-20 12:14:02"))
    assert.ok(html.includes(">Reset</a>"))
    assert.ok(html.includes(">Full stack</a>"))
    assert.ok(html.includes("<td>graphql</td>"))
    assert.ok(html.includes(`href="/log?user=${STUDENT}&amp;view=actions"`))
    assert.ok(html.includes("&lt;b&gt;tests&lt;/b&gt; must pass"))
    assert.ok(html.includes("failed: 500"))
    assert.ok(!html.includes("Older"))
  })

  test("links to older rows with the same filters when the page is full", () => {
    const html = renderLogPage([row({ id: 9 }), row({ id: 7 })], {
      tabs,
      filters: { ...filters, action: "reset" },
      limit: 2,
    })
    assert.ok(html.includes('href="/log?action=reset&amp;view=actions&amp;before=7"'))
  })

  test("offers quick ranges ending today in Finnish time", () => {
    // 23:30 UTC is already the next day in Finland
    const now = new Date("2026-10-20T23:30:00Z")
    const html = renderLogPage([], { tabs, filters: { ...filters, from: "2026-10-15" }, limit: 200, now })
    assert.ok(html.includes('href="/log?from=2026-10-21&amp;view=actions">today</a>'))
    assert.ok(html.includes('<strong><a href="/log?from=2026-10-15&amp;view=actions">last 7 days</a></strong>'))
    assert.ok(html.includes('href="/log?from=2026-09-22&amp;view=actions">last 30 days</a>'))
    assert.ok(html.includes('name="from" value="2026-10-15"'))
  })

  test("highlights the filters in use and offers clearing them only then", () => {
    const plain = renderLogPage([], { tabs, filters, limit: 200 })
    assert.ok(!plain.includes("clear filters"))
    assert.ok(!plain.includes('class="active">'))

    const filtered = renderLogPage([], { tabs, filters: { ...filters, action: "reset", failed: true }, limit: 200 })
    assert.ok(filtered.includes('<select name="action" class="active">'))
    assert.ok(filtered.includes('<label class="active"><input type="checkbox" name="failed" value="1" checked>'))
    assert.ok(filtered.includes('<a href="/log?view=actions">clear filters</a>'))
    assert.ok(filtered.includes('/static/logPage.js'))
  })

  test("marks the rows of the scheduled grading", () => {
    const html = renderLogPage(
      [row({ actor_uid: "node-cron", action: "auto_grade_run", details: { reset: 1, failed: 0, full_points: 3, invitations: 2 } })],
      { tabs, filters, limit: 200 },
    )
    assert.ok(html.includes('<span class="badge log-cron">node-cron</span>'))
    assert.ok(html.includes(">Scheduled run</a>"))
    assert.ok(html.includes('<tr class="log-run">'))
    assert.deepEqual([...html.matchAll(/log-detail">(\w+):/g)].map((m) => m[1]), ["invitations", "full_points", "reset", "failed"])
  })

  test("the summary counts the actions per day and course", () => {
    const count = (fields) => ({ day: "2026-10-20", tab_id: null, course_id: null, exercise_id: null, actor_uid: "mluukkai", action: "full_points", count: 1, failed: 0, ...fields })
    const html = renderLogPage(
      [
        count({ day: "2026-10-19", exercise_id: "ex1", action: "reset", count: 2 }),
        count({ action: "auto_grade_run", actor_uid: "node-cron", count: 6 }),
        count({ exercise_id: "ex1", action: "reset", count: 3, failed: 1 }),
        count({ course_id: "c1", actor_uid: "node-cron", count: 4 }),
      ],
      { tabs, filters: { ...filters, view: null, tabId: "fs" }, limit: 200 },
    )
    const days = [...html.matchAll(/rowspan="(\d)"><a href="([^"]+)">([\d-]+)</g)].map((m) => [m[3], m[1], m[2]])
    assert.deepEqual(days, [
      ["2026-10-20", "2", "/log?tab=fs&amp;from=2026-10-20&amp;to=2026-10-20&amp;view=actions"],
      ["2026-10-19", "1", "/log?tab=fs&amp;from=2026-10-19&amp;to=2026-10-19&amp;view=actions"],
    ])
    // ex1 and c1 are the same course; the rows without a course come last
    assert.ok(html.includes('<td>graphql</td><td>Full points: 4<br>Reset: 3 <span class="grade-fail">(1 failed)</span></td><td>mluukkai, <span class="badge log-cron">node-cron</span></td><td>7</td><td><span class="grade-fail">1</span></td>'))
    assert.ok(html.indexOf("graphql") < html.indexOf("no course"))
    assert.ok(html.includes("Scheduled run: 6"))
    assert.ok(!html.includes('type="hidden" name="view"'))
    assert.ok(html.includes('<a href="/log">clear filters</a>'))
    assert.ok(html.includes('<a href="/log?tab=fs" class="active" aria-current="page">Daily summary</a><a href="/log?tab=fs&amp;view=actions">All actions</a>'))
    assert.ok(!html.includes("Older"))
  })

  test("offers the previous week from Monday to Sunday", () => {
    // Thursday 2026-10-22 in Finland
    const now = new Date("2026-10-22T10:00:00Z")
    const html = renderLogPage([], { tabs, filters: { ...filters, view: "report", from: "2026-10-12", to: "2026-10-18" }, limit: 200, now })
    assert.ok(html.includes('<strong><a href="/log?from=2026-10-12&amp;to=2026-10-18&amp;view=report">previous week</a></strong>'))
  })

  test("the report sums up the range by action, course and admin", () => {
    const count = (fields) => ({ day: "2026-10-20", tab_id: null, course_id: null, exercise_id: null, actor_uid: "mluukkai", action: "full_points", count: 1, failed: 0, ...fields })
    const html = renderLogPage(
      [
        count({ day: "2026-10-19", exercise_id: "ex1", action: "reset", count: 2, failed: 1 }),
        count({ exercise_id: "ex1", count: 3 }),
        count({ action: "auto_grade_run", actor_uid: "node-cron", count: 4 }),
        count({ actor_uid: "ousavola", course_id: "c1", count: 5 }),
      ],
      {
        tabs,
        filters: { ...filters, view: "report", from: "2026-10-14", to: "2026-10-20" },
        failures: [row({ action: "reset", exercise_id: "ex1", ok: false, error: "500" })],
        limit: 200,
      },
    )
    assert.ok(html.includes("<h2>Report: 2026-10-14 – 2026-10-20</h2>"))
    const stats = [...html.matchAll(/log-stat"><strong>(.*?)<\/strong>([\w ]+)</g)].map((m) => [m[1], m[2]])
    assert.deepEqual(stats, [
      ["14", "actions"],
      ['<span class="grade-fail">1</span>', "failed"],
      ["2", "active days"],
      ["2", "admins"],
      ["4", "scheduled runs"],
    ])
    assert.ok(html.includes('>Full points</a></td><td>mluukkai, ousavola</td><td>8</td>'))
    assert.ok(html.includes('<td>graphql</td><td>Full points: 8<br>Reset: 2 <span class="grade-fail">(1 failed)</span></td><td>mluukkai, ousavola</td><td>10</td>'))
    assert.ok(html.includes('>mluukkai</a></td><td>Full points: 3<br>Reset: 2 <span class="grade-fail">(1 failed)</span></td><td>graphql</td><td>5</td>'))
    assert.ok(html.includes('<span class="none">no course</span></td><td>4</td>'))
    assert.ok(html.includes("<h3>Failed actions</h3>"))
    assert.ok(html.includes("failed: 500"))
    assert.ok(html.includes('aria-current="page">Report</a>'))
  })

  test("the report says when there is nothing in the range", () => {
    const html = renderLogPage([], { tabs, filters: { ...filters, view: "report" }, limit: 200 })
    assert.ok(html.includes("<h2>Report: all time</h2>"))
    assert.ok(html.includes("No actions."))
  })

  test("says when the log is off", () => {
    const html = renderLogPage([], { tabs, filters, limit: 200, enabled: false })
    assert.ok(html.includes("DATABASE_URL is not set"))
  })
})
