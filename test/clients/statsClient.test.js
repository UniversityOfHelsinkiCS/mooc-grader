const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const { createStatsClient } = require("../../src/clients/statsClient")
const { fakeHttp } = require("../helpers")

const url = "https://stats.test/stats/external-api/courses/akateemiset-taidot"

describe("statsClient", () => {
  test("returns the count", async () => {
    const http = fakeHttp({ "GET /external-api/courses/": { status: 200, body: { count: 3 } } })
    const stats = createStatsClient({ http })

    assert.equal(await stats.fetchCompletionCount(url), 3)
    assert.equal(http.calls[0].url, url)
  })

  test("fails when the response has no count", async () => {
    const stats = createStatsClient({
      http: fakeHttp({ "GET /external-api/": { status: 200, body: "<html>login</html>" } }),
    })

    await assert.rejects(
      stats.fetchCompletionCount(url),
      /Stats request to stats.test failed \(200\)/,
    )
  })
})
