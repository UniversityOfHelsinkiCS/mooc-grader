const { test, describe, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { createApp } = require("../../src/app")
const http = require("node:http")
const { startServer } = require("../helpers")

// fetch() replaces Sec-Fetch-Mode with its own value, so requests that must
// look like browser navigations are sent with http.request
function getWithHeaders(url, headers) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        res.resume()
        res.on("end", () => resolve(res.statusCode))
      })
      .on("error", reject)
  })
}

const gradeBody = JSON.stringify({
  user_exercise_state_id: "33333333-3333-4333-8333-333333333333",
  exercise_id: "ex1",
  action: "FullPoints",
})

describe("CSRF protection", () => {
  let server
  let gradingCalls = 0

  before(async () => {
    const mooc = {
      postGradingDecision: async () => {
        gradingCalls++
        return { status: 200, body: {} }
      },
    }
    const courseService = {
      fetchTabData: async () => [{
        exerciseId: "ex1",
        courseId: null,
        name: "ci",
        gha: false,
        qr: false,
        linkCount: null,
        cheaterCount: null,
        answers: [],
      }],
      fetchTabOverview: async (tab) => ({
        id: tab.id,
        name: tab.name,
               answerCount: 0,
        cheaterCount: 0,
        failed: [],
      }),
    }
    server = await startServer(
      createApp({
        tabs: [{ id: "t", name: "T", courses: [{ exerciseId: "ex1", name: "ci" }] }],
        mooc,
        courseService,
        auth: { allowedUids: [], enforce: false },
      }),
    )
  })

  after(() => server.close())

  function postGrade(headers, body = gradeBody) {
    return fetch(`${server.url}/grade`, { method: "POST", headers, body })
  }

  const json = { "Content-Type": "application/json" }

  test("accepts a JSON POST from the app's own page", async () => {
    gradingCalls = 0
    const response = await postGrade({ ...json, "Sec-Fetch-Site": "same-origin" })
    assert.equal(response.status, 200)
    assert.equal(gradingCalls, 1)
  })

  test("rejects POSTs that a browser marks as coming from another site", async (t) => {
    t.mock.method(console, "warn", () => {})
    gradingCalls = 0
    for (const site of ["cross-site", "same-site", "none"]) {
      const response = await postGrade({ ...json, "Sec-Fetch-Site": site })
      assert.equal(response.status, 403, site)
      assert.equal((await response.json()).error, "Cross-origin request rejected")
    }
    assert.equal(gradingCalls, 0)
  })

  test("falls back to the Origin header on older browsers", async (t) => {
    t.mock.method(console, "warn", () => {})
    const host = new URL(server.url).host

    const own = await postGrade({ ...json, Origin: server.url })
    assert.equal(own.status, 200)

    for (const origin of ["https://student.example", "null"]) {
      const response = await postGrade({ ...json, Origin: origin })
      assert.equal(response.status, 403, origin)
    }

    const behindProxy = await postGrade({
      ...json,
      Origin: "https://grader.example",
      "X-Forwarded-Host": "grader.example",
      Host: host,
    })
    assert.equal(behindProxy.status, 200)
  })

  test("rejects bodies that a cross-site form could send", async () => {
    gradingCalls = 0
    const bodies = [
      ["application/x-www-form-urlencoded", "action=FullPoints&exercise_id=ex1"],
      ["text/plain", gradeBody],
      ["multipart/form-data; boundary=x", "--x--"],
    ]
    for (const [type, body] of bodies) {
      const response = await postGrade({ "Content-Type": type }, body)
      assert.equal(response.status, 415, type)
    }
    assert.equal(gradingCalls, 0)
  })

  test("applies to every state-changing route", async (t) => {
    t.mock.method(console, "warn", () => {})
    for (const path of ["/grade", "/completion", "/confirm-cheater", "/dismiss-cheater"]) {
      const response = await fetch(`${server.url}${path}`, {
        method: "POST",
        headers: { ...json, "Sec-Fetch-Site": "cross-site" },
        body: "{}",
      })
      assert.equal(response.status, 403, path)
    }
  })

  test("allows opening pages from links on other sites and from bookmarks", async () => {
    const opened = [
      { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" },
      { "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" },
      { "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "script" },
      {},
    ]
    for (const headers of opened) {
      const status = await getWithHeaders(`${server.url}/`, headers)
      assert.equal(status, 200, JSON.stringify(headers))
    }
  })

  test("rejects pages and files loaded by other sites as images, frames or fetches", async (t) => {
    t.mock.method(console, "warn", () => {})
    const embedded = [
      { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" },
      { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe" },
      { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" },
      { "Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "script" },
    ]
    for (const path of ["/", "/t", "/static/grading.js"]) {
      for (const headers of embedded) {
        const status = await getWithHeaders(`${server.url}${path}`, headers)
        assert.equal(status, 403, `${path} ${JSON.stringify(headers)}`)
      }
    }
  })
})
