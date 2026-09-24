const { test, describe, before, after } = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const { createHttpClient } = require("../../src/infra/httpClient")

// Local server whose handler can be swapped per test; records request headers
async function startServer() {
  const server = http.createServer((req, res) => server.handler(req, res))
  server.requests = []
  server.handler = (req, res) => res.end("{}")
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  server.url = `http://127.0.0.1:${server.address().port}`
  return server
}

function recordAnd(server, respond) {
  server.handler = (req, res) => {
    server.requests.push({ url: req.url, headers: req.headers })
    respond(req, res)
  }
}

function redirect(res, location) {
  res.writeHead(302, { Location: location })
  res.end()
}

describe("httpClient", () => {
  let origin
  let other
  const client = createHttpClient({ transport: http, timeoutMs: 200 })
  const credentials = { Cookie: "session=secret", Authorization: "Bearer t" }

  before(async () => {
    origin = await startServer()
    other = await startServer()
  })

  after(() => {
    origin.close()
    other.close()
  })

  test("parses JSON responses and keeps other bodies as text", async () => {
    recordAnd(origin, (req, res) =>
      res.end(req.url === "/json" ? '{"a":1}' : "not json"),
    )
    assert.deepEqual(await client.get(`${origin.url}/json`), {
      status: 200,
      body: { a: 1 },
    })
    assert.equal((await client.get(`${origin.url}/text`)).body, "not json")
  })

  test("posts JSON", async () => {
    let received
    origin.handler = (req, res) => {
      let data = ""
      req.on("data", (chunk) => (data += chunk))
      req.on("end", () => {
        received = { type: req.headers["content-type"], data }
        res.end("{}")
      })
    }
    await client.postJson(`${origin.url}/x`, { ä: 1 })
    assert.deepEqual(received, { type: "application/json", data: '{"ä":1}' })
  })

  test("keeps credentials on a same-origin redirect, including relative ones", async () => {
    origin.requests = []
    recordAnd(origin, (req, res) =>
      req.url === "/old" ? redirect(res, "/new") : res.end('"ok"'),
    )

    const response = await client.get(`${origin.url}/old`, credentials)

    assert.equal(response.body, "ok")
    assert.equal(origin.requests[1].url, "/new")
    assert.equal(origin.requests[1].headers.cookie, "session=secret")
    assert.equal(origin.requests[1].headers.authorization, "Bearer t")
  })

  test("drops credentials when redirected to another origin", async () => {
    other.requests = []
    recordAnd(origin, (req, res) => redirect(res, `${other.url}/elsewhere`))
    recordAnd(other, (req, res) => res.end('"moved"'))

    const response = await client.get(`${origin.url}/old`, {
      ...credentials,
      "User-Agent": "crawler",
    })

    assert.equal(response.body, "moved")
    const { headers } = other.requests[0]
    assert.equal(headers.cookie, undefined)
    assert.equal(headers.authorization, undefined)
    assert.equal(headers["user-agent"], "crawler")
  })

  test("gives up on redirect loops", async () => {
    recordAnd(origin, (req, res) => redirect(res, "/loop"))
    await assert.rejects(client.get(`${origin.url}/loop`), /Too many redirects/)
  })

  test("aborts a response that is too large", async () => {
    const small = createHttpClient({ transport: http, maxResponseBytes: 1000 })
    origin.handler = (req, res) => res.end("x".repeat(1001))
    await assert.rejects(small.get(`${origin.url}/big`), /exceeds 1000 bytes/)

    origin.handler = (req, res) => {
      res.write("x".repeat(600))
      setTimeout(() => res.end("x".repeat(600)), 10)
    }
    await assert.rejects(small.get(`${origin.url}/streamed`), /exceeds 1000 bytes/)

    origin.handler = (req, res) => res.end("x".repeat(1000))
    assert.equal((await small.get(`${origin.url}/ok`)).body.length, 1000)
  })

  test("decodes UTF-8 characters split between chunks", async () => {
    origin.handler = (req, res) => {
      const bytes = Buffer.from('"ä"')
      res.write(bytes.subarray(0, 2))
      setTimeout(() => res.end(bytes.subarray(2)), 10)
    }
    assert.equal((await client.get(`${origin.url}/utf8`)).body, "ä")
  })

  test("times out a hanging request", async () => {
    origin.handler = () => {}
    await assert.rejects(client.get(`${origin.url}/hang`), /timed out/)
  })
})
