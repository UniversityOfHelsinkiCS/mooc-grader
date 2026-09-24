const { test, describe, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { createApp } = require("../../src/app")
const { loadConfig } = require("../../src/config")
const { startServer } = require("../helpers")

describe("access control", () => {
  let server
  let upstreamCalls = 0

  before(async () => {
    const mooc = {
      postGradingDecision: async () => {
        upstreamCalls++
        return { status: 200, body: {} }
      },
    }
    const courseService = {
      fetchTabOverview: async () => {
        upstreamCalls++
        throw new Error("should not be reached in these tests")
      },
      fetchTabData: async () => {
        upstreamCalls++
        throw new Error("should not be reached in these tests")
      },
    }
    server = await startServer(
      createApp({
        tabs: [{ id: "t", name: "T", courses: [{ exerciseId: "ex1", name: "graphql" }] }],
        mooc,
        courseService,
        auth: { allowedUids: ["mluukkai", "ousavola"], enforce: true },
      }),
    )
  })

  after(() => server.close())

  function request(path, uid, options = {}) {
    const headers = { ...options.headers, ...(uid ? { uid } : {}) }
    return fetch(`${server.url}${path}`, { ...options, headers })
  }

  test("rejects requests without a uid", async (t) => {
    t.mock.method(console, "warn", () => {})
    for (const path of ["/", "/static/styles.css", "/t", "/cheaters/x", "/nope"]) {
      const response = await request(path)
      assert.equal(response.status, 403, path)
      assert.equal(await response.text(), "Forbidden")
    }
  })

  test("rejects users who are not allowed", async (t) => {
    t.mock.method(console, "warn", () => {})
    for (const uid of ["someone", "MLUUKKAI", "mluukkai2"]) {
      const response = await request("/static/styles.css", uid)
      assert.equal(response.status, 403, uid)
    }
  })

  test("rejects API calls before they reach mooc.fi", async (t) => {
    t.mock.method(console, "warn", () => {})
    upstreamCalls = 0
    const response = await request("/grade", "someone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_exercise_state_id: "33333333-3333-4333-8333-333333333333",
        exercise_id: "ex1",
        action: "FullPoints",
      }),
    })
    assert.equal(response.status, 403)
    assert.equal(upstreamCalls, 0)
  })

  test("lets allowed users through", async () => {
    for (const uid of ["mluukkai", "ousavola"]) {
      const response = await request("/static/styles.css", uid)
      assert.equal(response.status, 200, uid)
    }
  })
})

describe("auth config", () => {
  const env = (NODE_ENV) => ({ NODE_ENV, COOKIE_FILE: __filename })

  test("normalizes BASE_PATH", () => {
    const basePath = (value) => loadConfig({ ...env("production"), BASE_PATH: value }).basePath
    assert.equal(basePath(undefined), "")
    assert.equal(basePath("/"), "")
    assert.equal(basePath("/mooc-grader"), "/mooc-grader")
    assert.equal(basePath("mooc-grader/"), "/mooc-grader")
    assert.equal(basePath("/a/b/"), "/a/b")
    for (const bad of ['/x"><script>', "/a//b", "/ä"]) {
      assert.throws(() => basePath(bad), /Invalid BASE_PATH/, bad)
    }
  })

  test("is enforced unless running in development", () => {
    assert.equal(loadConfig(env("production")).auth.enforce, true)
    assert.equal(loadConfig(env(undefined)).auth.enforce, true)
    assert.equal(loadConfig(env("test")).auth.enforce, true)
    assert.equal(loadConfig(env("development")).auth.enforce, false)
  })

  test("reads allowed users from ALLOWED_UIDS", () => {
    const config = loadConfig({
      ...env("production"),
      ALLOWED_UIDS: " mluukkai, ousavola ,,",
    })
    assert.deepEqual(config.auth.allowedUids, ["mluukkai", "ousavola"])
  })

  test("allows nobody when ALLOWED_UIDS is not set", () => {
    assert.deepEqual(loadConfig(env("production")).auth.allowedUids, [])
    assert.deepEqual(
      loadConfig({ ...env("production"), ALLOWED_UIDS: "" }).auth.allowedUids,
      [],
    )
  })
})
