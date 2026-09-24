const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const { withCache, withConcurrencyLimit } = require("../../src/infra/httpWrappers")

// Fake http client whose responses resolve when release() is called
function controllableHttp(responder = () => ({ status: 200, body: "ok" })) {
  const calls = []
  let active = 0
  let maxActive = 0
  const pending = []

  function handle(method, url) {
    calls.push(`${method} ${url}`)
    active++
    maxActive = Math.max(maxActive, active)
    return new Promise((resolve, reject) => {
      pending.push(() => {
        active--
        try {
          resolve(responder(url))
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  return {
    calls,
    maxActive: () => maxActive,
    releaseAll: async () => {
      while (pending.length > 0) {
        pending.shift()()
        await new Promise((resolve) => setImmediate(resolve))
      }
    },
    get: (url) => handle("GET", url),
    postJson: (url) => handle("POST", url),
  }
}

// Fake http client that answers immediately
function instantHttp(responder = () => ({ status: 200, body: "ok" })) {
  const calls = []
  return {
    calls,
    get: async (url) => {
      calls.push(url)
      return responder(url)
    },
    postJson: async (url) => {
      calls.push(`POST ${url}`)
      return { status: 200, body: null }
    },
  }
}

describe("withConcurrencyLimit", () => {
  test("keeps at most max requests in flight and runs them all", async () => {
    const http = controllableHttp()
    const limited = withConcurrencyLimit(http, 3)

    const requests = Array.from({ length: 10 }, (_, i) => limited.get(`/r${i}`))
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(http.calls.length, 3)

    await http.releaseAll()
    const responses = await Promise.all(requests)

    assert.equal(responses.length, 10)
    assert.equal(http.calls.length, 10)
    assert.equal(http.maxActive(), 3)
  })

  test("frees the slot when a request fails", async () => {
    const http = instantHttp((url) => {
      if (url === "/fail") throw new Error("boom")
      return { status: 200, body: url }
    })
    const limited = withConcurrencyLimit(http, 1)

    await assert.rejects(limited.get("/fail"), /boom/)
    assert.equal((await limited.get("/next")).body, "/next")
  })
})

describe("withCache", () => {
  function clock() {
    let time = 0
    return { now: () => time, advance: (ms) => (time += ms) }
  }

  test("serves repeated GETs from the cache until they expire", async () => {
    const time = clock()
    const http = instantHttp()
    const cached = withCache(http, { ttlMs: 1000, now: time.now })

    await cached.get("/a")
    await cached.get("/a")
    time.advance(999)
    await cached.get("/a")
    assert.equal(http.calls.length, 1)

    time.advance(1)
    await cached.get("/a")
    assert.equal(http.calls.length, 2)
  })

  test("caches 404 answers but retries errors and rate limits", async () => {
    const statuses = { "/missing": 404, "/error": 500, "/limited": 429 }
    const http = instantHttp((url) => ({ status: statuses[url], body: null }))
    const cached = withCache(http, { ttlMs: 1000 })

    for (const url of Object.keys(statuses)) {
      await cached.get(url)
      await cached.get(url)
    }

    assert.deepEqual(http.calls, [
      "/missing",
      "/error",
      "/error",
      "/limited",
      "/limited",
    ])
  })

  test("retries after a network failure", async () => {
    let fail = true
    const http = instantHttp(() => {
      if (fail) throw new Error("ECONNRESET")
      return { status: 200, body: "ok" }
    })
    const cached = withCache(http, { ttlMs: 1000 })

    await assert.rejects(cached.get("/a"), /ECONNRESET/)
    fail = false
    assert.equal((await cached.get("/a")).body, "ok")
  })

  test("shares one request between concurrent GETs of the same URL", async () => {
    const http = controllableHttp()
    const cached = withCache(http, { ttlMs: 1000 })

    const both = Promise.all([cached.get("/a"), cached.get("/a")])
    await http.releaseAll()
    const [first, second] = await both

    assert.equal(http.calls.length, 1)
    assert.equal(first, second)
  })

  test("never caches POSTs", async () => {
    const http = instantHttp()
    const cached = withCache(http, { ttlMs: 1000 })

    await cached.postJson("/grade", {})
    await cached.postJson("/grade", {})

    assert.deepEqual(http.calls, ["POST /grade", "POST /grade"])
  })

  test("evicts the oldest entries when the cache is full of fresh ones", async () => {
    const http = instantHttp()
    const cached = withCache(http, { ttlMs: 1000, maxEntries: 2 })

    await cached.get("/a")
    await cached.get("/b")
    await cached.get("/c")
    await cached.get("/b")
    await cached.get("/c")
    await cached.get("/a")

    assert.deepEqual(http.calls, ["/a", "/b", "/c", "/a"])
  })

  test("drops expired entries when the cache is full", async () => {
    const time = clock()
    const http = instantHttp()
    const cached = withCache(http, { ttlMs: 10, now: time.now, maxEntries: 2 })

    await cached.get("/a")
    await cached.get("/b")
    time.advance(10)
    await cached.get("/c")
    time.advance(-10)
    // /a expired and was pruned, so it is fetched again even at the old time
    await cached.get("/a")

    assert.deepEqual(http.calls, ["/a", "/b", "/c", "/a"])
  })
})
