const { test, describe, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { createApp } = require("../../src/app")
const { CONTENT_SECURITY_POLICY } = require("../../src/middleware/securityHeaders")
const { startServer } = require("../helpers")

describe("security headers", () => {
  let server

  before(async () => {
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
        mooc: {},
        courseService,
        auth: { allowedUids: ["mluukkai"], enforce: true },
      }),
    )
  })

  after(() => server.close())

  function assertSecurityHeaders(response, label) {
    const headers = response.headers
    assert.equal(headers.get("content-security-policy"), CONTENT_SECURITY_POLICY, label)
    assert.equal(headers.get("x-frame-options"), "DENY", label)
    assert.equal(headers.get("x-content-type-options"), "nosniff", label)
    assert.equal(headers.get("x-powered-by"), null, label)
  }

  test("are set on pages, static files and API responses", async () => {
    const requests = [
      ["/", {}],
      ["/static/grading.js", {}],
      ["/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }],
    ]
    for (const [path, options] of requests) {
      const response = await fetch(`${server.url}${path}`, {
        ...options,
        headers: { ...options.headers, uid: "mluukkai" },
      })
      assertSecurityHeaders(response, path)
    }
  })

  test("stop browsers and proxies from storing pages with student data", async () => {
    for (const path of ["/", "/t"]) {
      const response = await fetch(`${server.url}${path}`, { headers: { uid: "mluukkai" } })
      assert.equal(response.headers.get("cache-control"), "no-store", path)
    }
    const api = await fetch(`${server.url}/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json", uid: "mluukkai" },
      body: "{}",
    })
    assert.equal(api.headers.get("cache-control"), "no-store")

    const asset = await fetch(`${server.url}/static/styles.css`, { headers: { uid: "mluukkai" } })
    assert.notEqual(asset.headers.get("cache-control"), "no-store")
  })

  test("are set on rejected requests too", async (t) => {
    t.mock.method(console, "warn", () => {})
    const response = await fetch(`${server.url}/`)
    assert.equal(response.status, 403)
    assertSecurityHeaders(response, "403")
  })

  test("the policy denies framing and scripts from other origins", () => {
    assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/)
    assert.match(CONTENT_SECURITY_POLICY, /default-src 'self'/)
    assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-inline|unsafe-eval/)
  })

  test("pages contain no inline scripts, styles or event handlers the policy would block", async () => {
    for (const path of ["/", "/t"]) {
      const response = await fetch(`${server.url}${path}`, { headers: { uid: "mluukkai" } })
      const html = await response.text()
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, path)
      assert.doesNotMatch(html, /<style|\sstyle=|\son[a-z]+=/i, path)
    }
  })
})
