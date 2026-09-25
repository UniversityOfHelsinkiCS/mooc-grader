const https = require("https")

const CREDENTIAL_HEADERS = ["cookie", "authorization"]

function isRedirectStatus(status) {
  return status === 301 || status === 302
}

function tryParseJson(input) {
  try {
    return JSON.parse(input)
  } catch {
    return input
  }
}

// Credentials are only ever sent to the origin they were meant for
function withoutCredentials(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !CREDENTIAL_HEADERS.includes(name.toLowerCase()),
    ),
  )
}

// transport is the node https module, or http in tests.
// maxResponseBytes: larger responses are aborted (the biggest expected one,
// a README of about 1 MB, is under 1.5 MB as base64 JSON)
function createHttpClient({
  transport = https,
  timeoutMs = 30_000,
  maxRedirects = 5,
  maxResponseBytes = 5 * 1024 * 1024,
} = {}) {
  function request(method, url, headers = {}, body = null, redirects = 0) {
    return new Promise((resolve, reject) => {
      const target = new URL(url)
      const req = transport.request(target, { method, headers }, (res) => {
        if (isRedirectStatus(res.statusCode) && res.headers.location) {
          res.resume()
          if (redirects >= maxRedirects) {
            return reject(new Error(`Too many redirects from ${target.origin}`))
          }
          const next = new URL(res.headers.location, target)
          const nextHeaders =
            next.origin === target.origin ? headers : withoutCredentials(headers)
          return request(method, next.href, nextHeaders, body, redirects + 1)
            .then(resolve)
            .catch(reject)
        }

        const chunks = []
        let size = 0
        let tooLarge = false
        res.on("data", (chunk) => {
          size += chunk.length
          if (size > maxResponseBytes) {
            tooLarge = true
            res.destroy()
            reject(
              new Error(`Response from ${target.origin} exceeds ${maxResponseBytes} bytes`),
            )
            return
          }
          chunks.push(chunk)
        })
        res.on("end", () => {
          if (tooLarge) return
          const data = Buffer.concat(chunks).toString("utf8")
          resolve({ status: res.statusCode, body: tryParseJson(data) })
        })
        res.on("error", reject)
      })

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Request to ${target.origin} timed out`))
      })
      req.on("error", reject)
      if (body) {
        req.write(body)
      }
      req.end()
    })
  }

  function get(url, headers = {}) {
    return request("GET", url, headers)
  }

  function postJson(url, payloadObject, headers = {}) {
    const payload = JSON.stringify(payloadObject)
    return request(
      "POST",
      url,
      {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...headers,
      },
      payload,
    )
  }

  // Bodyless requests with other methods, e.g. PATCH or DELETE
  function send(method, url, headers = {}) {
    return request(method, url, headers)
  }

  return { get, postJson, send }
}

module.exports = { createHttpClient, tryParseJson }
