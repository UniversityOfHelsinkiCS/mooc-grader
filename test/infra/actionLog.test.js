const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const { createActionLog } = require("../../src/infra/actionLog")
const { silenceConsoleErrors } = require("../helpers")

describe("createActionLog", () => {
  test("inserts a row with details as JSON and missing columns as null", async () => {
    const queries = []
    const actionLog = createActionLog({
      db: { query: async (text, values) => queries.push({ text, values }) },
    })

    await actionLog.log({
      actor_uid: "mluukkai",
      action: "reset",
      exercise_id: "ex1",
      details: { justification: "tests must pass in GitHub" },
      ok: true,
    })

    const [{ text, values }] = queries
    assert.match(text, /^INSERT INTO action_log \(actor_uid, action, .*\) VALUES \(\$1, \$2, /)
    assert.deepEqual(values, [
      "mluukkai",
      "reset",
      null,
      null,
      "ex1",
      null,
      null,
      '{"justification":"tests must pass in GitHub"}',
      true,
      null,
    ])
  })

  test("a failing write does not reject", async (t) => {
    silenceConsoleErrors(t)
    const actionLog = createActionLog({
      db: {
        query: async () => {
          throw new Error('relation "action_log" does not exist')
        },
      },
    })
    await actionLog.log({ action: "full_points", ok: true })
    assert.equal(console.error.mock.callCount(), 1)
  })

  test("recent rows are queried with every filter as a parameter, unset ones null", async () => {
    const queries = []
    const actionLog = createActionLog({
      db: {
        query: async (text, values) => {
          queries.push({ text, values })
          return { rows: [{ id: 3 }] }
        },
      },
    })

    const rows = await actionLog.recent({
      limit: 50,
      before: "10",
      filters: { actor: "mluukkai", action: "reset", failed: true, from: "2026-10-01" },
    })

    assert.deepEqual(rows, [{ id: 3 }])
    assert.match(queries[0].text, /ORDER BY id DESC/)
    assert.deepEqual(queries[0].values, ["10", "mluukkai", "reset", null, null, true, "2026-10-01", null, 50])
  })

  test("the summary counts the actions per Finnish day with the same filters", async () => {
    const queries = []
    const actionLog = createActionLog({
      db: {
        query: async (text, values) => {
          queries.push({ text, values })
          return { rows: [] }
        },
      },
    })

    await actionLog.summary({ filters: { tabId: "fs", to: "2026-10-20" } })

    assert.match(queries[0].text, /GROUP BY day, tab_id, course_id, exercise_id, actor_uid, action/)
    assert.match(queries[0].text, /AT TIME ZONE 'Europe\/Helsinki', 'YYYY-MM-DD'\) AS day/)
    assert.deepEqual(queries[0].values, [null, null, null, "fs", null, false, null, "2026-10-20"])
  })
})
