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
        filters: { actor: "mluukkai", action: "reset", tabId: "fs", userId: null, failed: true, from: "2026-10-01", to: "2026-10-20" },
      },
    )
    assert.deepEqual(parseLogQuery({ action: "drop table", before: "-1", actor: ["a", "b"], from: "2026-13-45", to: "yesterday" }), {
      before: null,
      filters: { actor: null, action: null, tabId: null, userId: null, failed: false, from: null, to: null },
    })
  })
})

describe("renderLogPage", () => {
  const filters = parseLogQuery({}).filters

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
    assert.ok(html.includes(`href="/log?user=${STUDENT}"`))
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
    assert.ok(html.includes('href="/log?action=reset&amp;before=7"'))
  })

  test("offers quick ranges ending today in Finnish time", () => {
    // 23:30 UTC is already the next day in Finland
    const now = new Date("2026-10-20T23:30:00Z")
    const html = renderLogPage([], { tabs, filters: { ...filters, from: "2026-10-15" }, limit: 200, now })
    assert.ok(html.includes('href="/log?from=2026-10-21">today</a>'))
    assert.ok(html.includes('<strong><a href="/log?from=2026-10-15">last 7 days</a></strong>'))
    assert.ok(html.includes('href="/log?from=2026-09-22">last 30 days</a>'))
    assert.ok(html.includes('name="from" value="2026-10-15"'))
  })

  test("highlights the filters in use and offers clearing them only then", () => {
    const plain = renderLogPage([], { tabs, filters, limit: 200 })
    assert.ok(!plain.includes("clear filters"))
    assert.ok(!plain.includes('class="active"'))

    const filtered = renderLogPage([], { tabs, filters: { ...filters, action: "reset", failed: true }, limit: 200 })
    assert.ok(filtered.includes('<select name="action" class="active">'))
    assert.ok(filtered.includes('<label class="active"><input type="checkbox" name="failed" value="1" checked>'))
    assert.ok(filtered.includes('<a href="/log">clear filters</a>'))
    assert.ok(filtered.includes('/static/logPage.js'))
  })

  test("marks the rows of the scheduled grading", () => {
    const html = renderLogPage(
      [row({ actor_uid: "node-cron", action: "auto_grade_run", details: { full_points: 3 } })],
      { tabs, filters, limit: 200 },
    )
    assert.ok(html.includes('<span class="badge log-cron">node-cron</span>'))
    assert.ok(html.includes(">Scheduled run</a>"))
  })

  test("says when the log is off", () => {
    const html = renderLogPage([], { tabs, filters, limit: 200, enabled: false })
    assert.ok(html.includes("DATABASE_URL is not set"))
  })
})
