// The stats services of the courses tell how many completions are waiting to
// be sent to Suotar, answering { count }

function createStatsClient({ http }) {
  async function fetchCompletionCount(url) {
    const { status, body } = await http.get(url)
    if (status !== 200 || !Number.isInteger(body?.count)) {
      throw new Error(`Stats request to ${new URL(url).host} failed (${status})`)
    }
    return body.count
  }

  return { fetchCompletionCount }
}

module.exports = { createStatsClient }
