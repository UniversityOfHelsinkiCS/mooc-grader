// Wrappers around an http client ({ get, postJson }) that keep its interface

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
  }
}

// Caches GET responses that are definitive answers (200 and 404) for ttlMs.
// Concurrent requests for the same URL share one request. Errors and rate
// limit responses are not cached, so they are retried on the next load.
// At most maxEntries responses are kept; when full, expired entries go
// first and then the oldest ones.
function withCache(http, { ttlMs, now = Date.now, maxEntries = 1000 }) {
  const cache = new Map()

  function makeRoom() {
    const time = now()
    for (const [url, entry] of cache) {
      if (entry.expires <= time) cache.delete(url)
    }
    // a Map iterates in insertion order, so the first keys are the oldest
    for (const url of cache.keys()) {
      if (cache.size < maxEntries) break
      cache.delete(url)
    }
  }

  function get(url, headers) {
    const entry = cache.get(url)
    if (entry && entry.expires > now()) {
      return entry.response
    }

    if (cache.size >= maxEntries) makeRoom()

    const response = http.get(url, headers).then(
      (result) => {
        if (result.status !== 200 && result.status !== 404) {
          cache.delete(url)
        }
        return result
      },
      (error) => {
        cache.delete(url)
        throw error
      },
    )
    cache.set(url, { response, expires: now() + ttlMs })
    return response
  }

  return { get, postJson: http.postJson }
}

module.exports = { withConcurrencyLimit, withCache }
