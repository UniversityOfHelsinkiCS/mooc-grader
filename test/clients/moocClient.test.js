const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const { createMoocClient } = require("../../src/clients/moocClient")
const { fakeHttp, silenceConsoleErrors } = require("../helpers")

const baseUrl = "https://mooc.test/api"

function client(routes) {
  const http = fakeHttp(routes)
  return {
    http,
    mooc: createMoocClient({ http, baseUrl, cookie: "session=abc", pageLimit: 2 }),
  }
}

describe("fetchAllAnswers", () => {
  test("fetches every page with the session cookie", async () => {
    const { mooc, http } = client({
      "GET page=1&": { status: 200, body: { total_pages: 2, data: [{ id: 1 }, { id: 2 }] } },
      "GET page=2&": { status: 200, body: { total_pages: 2, data: [{ id: 3 }] } },
    })

    const answers = await mooc.fetchAllAnswers("ex1")

    assert.deepEqual(answers.map((a) => a.id), [1, 2, 3])
    assert.match(
      http.calls[0].url,
      /\/exercises\/ex1\/answers-requiring-attention\?page=1&limit=2$/,
    )
    assert.ok(http.calls.every((call) => call.headers.Cookie === "session=abc"))
  })
})

describe("fetchAllAnswers errors", () => {
  test("explains a rejected session cookie", async () => {
    for (const status of [401, 403]) {
      const { mooc } = client({
        "GET /answers-requiring-attention": { status, body: "Unauthorized" },
      })
      await assert.rejects(
        mooc.fetchAllAnswers("ex1"),
        /rejected the session cookie \(\d+\).*update the cookie/,
      )
    }
  })

  test("reports other failures with their status", async () => {
    const { mooc } = client({
      "GET /answers-requiring-attention": { status: 502, body: "<html>" },
    })
    await assert.rejects(mooc.fetchAllAnswers("ex1"), /answers request failed \(502\)/)
  })
})

describe("getFlaggedCheaters", () => {
  test("maps flagged users by id", async () => {
    const { mooc } = client({
      "GET /courses/c1/suspected-cheaters?status=Flagged": {
        status: 200,
        body: [
          { user_id: "u1", total_duration_seconds: 600, total_points: 12 },
        ],
      },
    })
    const cheaters = await mooc.getFlaggedCheaters("c1")
    assert.deepEqual(cheaters.get("u1"), {
      totalDurationSeconds: 600,
      totalPoints: 12,
    })
  })

  test("returns an empty map on errors or without a course", async (t) => {
    silenceConsoleErrors(t)
    const { mooc, http } = client({
      "GET /suspected-cheaters": () => {
        throw new Error("timeout")
      },
    })
    assert.equal((await mooc.getFlaggedCheaters("c1")).size, 0)
    assert.equal((await mooc.getFlaggedCheaters(null)).size, 0)
    assert.equal(http.calls.length, 1)
  })
})

describe("getUserCoursePoints", () => {
  test("sums the progress of the user", async () => {
    const { mooc } = client({
      "GET /courses/c1/progress/u1": {
        status: 200,
        body: [{ score_given: 20 }, { score_given: 25 }],
      },
    })
    assert.equal(await mooc.getUserCoursePoints("c1", "u1"), 45)
  })

  test("returns null when progress is not available", async () => {
    const { mooc } = client({})
    assert.equal(await mooc.getUserCoursePoints("c1", "u1"), null)
  })
})

describe("getUserDetails", () => {
  test("combines and trims the name", async () => {
    const { mooc, http } = client({
      "POST /user-details/user-by-courses": {
        status: 200,
        body: { first_name: " Ada ", last_name: "Lovelace", email: "ada@x.fi" },
      },
    })

    assert.deepEqual(await mooc.getUserDetails("c1", "u1"), {
      name: "Ada Lovelace",
      email: "ada@x.fi",
    })
    assert.deepEqual(http.calls[0].payload, {
      user_id: "u1",
      course_ids: ["c1"],
    })
  })

  test("uses null for missing fields", async () => {
    const { mooc } = client({
      "POST /user-details": { status: 200, body: { first_name: "" } },
    })
    assert.deepEqual(await mooc.getUserDetails("c1", "u1"), {
      name: null,
      email: null,
    })
  })
})

describe("write operations", () => {
  test("post to the mooc.fi endpoints", async () => {
    const { mooc, http } = client({})
    await mooc.postGradingDecision({ action: "FullPoints" })
    await mooc.postCompletions("inst1", { new_completions: [] })
    await mooc.postCheaterAction("c1", "confirm", "u1")

    assert.deepEqual(
      http.calls.map((call) => `${call.method} ${call.url}`),
      [
        `POST ${baseUrl}/teacher-grading-decisions`,
        `POST ${baseUrl}/course-instances/inst1/completions`,
        `POST ${baseUrl}/courses/c1/suspected-cheaters/confirm/u1`,
      ],
    )
  })
})
