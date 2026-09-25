const crypto = require("crypto")

// Wrappers around an http client ({ get, postJson, send }) that keep its
// interface

// At most `max` requests are in flight at once; the rest wait in order
function withConcurrencyLimit(http, max) {
  let active = 0
  const waiting = []

  async function limited(fn) {
    if (active >= max) {
      await new Promise((resolve) => waiting.push(resolve))
    }
    active++
    try {
      return await fn()
    } finally {
      active--
      waiting.shift()?.()
    }
  }

  return {
    get: (...args) => limited(() => http.get(...args)),
    postJson: (...args) => limited(() => http.postJson(...args)),
    send: (...args) => limited(() => http.send(...args)),
  }
}

// Caches GET responses that are definitive answers (200 and 404) for ttlMs.
// Concurrent requests for the same URL share one request. Errors and rate
// limit responses are not cached, so they are retried on the next load.
// At most maxEntries responses are kept; when full, expired entries go
// first and then the oldest ones.
// Responses are cached per URL and Authorization header: what one token may
// see (or not see) says nothing about another token. The header is kept only
// as a hash, so the cache holds no tokens.
function credentialKey(authorization) {
  return authorization
    ? crypto.createHash("sha256").update(authorization).digest("hex").slice(0, 16)
    : "-"
}

function withCache(http, { ttlMs, now = Date.now, maxEntries = 1000 }) {
  const cache = new Map()

  function makeRoom() {
    const time = now()
    for (const [key, entry] of cache) {
      if (entry.expires <= time) cache.delete(key)
    }
    // a Map iterates in insertion order, so the first keys are the oldest
    for (const key of cache.keys()) {
      if (cache.size < maxEntries) break
      cache.delete(key)
    }
  }

  function get(url, headers = {}) {
    const key = `${credentialKey(headers.Authorization)} ${url}`
    const entry = cache.get(key)
    if (entry && entry.expires > now()) {
      return entry.response
    }

    if (cache.size >= maxEntries) makeRoom()

    const response = http.get(url, headers).then(
      (result) => {
        if (result.status !== 200 && result.status !== 404) {
          cache.delete(key)
        }
        return result
      },
      (error) => {
        cache.delete(key)
        throw error
      },
    )
    cache.set(key, { response, expires: now() + ttlMs })
    return response
  }

  return { get, postJson: http.postJson, send: http.send }
}

module.exports = { withConcurrencyLimit, withCache, credentialKey }
