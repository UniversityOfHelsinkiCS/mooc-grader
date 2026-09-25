// Fake of src/infra/httpClient: routes are matched by "METHOD url-substring"
// and return { status, body } (or throw, when the handler throws)
function fakeHttp(routes) {
  const calls = []

  function handle(method, url, headers, payload) {
    calls.push({ method, url, headers, payload })
    const key = Object.keys(routes).find((route) => {
      const [routeMethod, fragment] = route.split(" ")
      return routeMethod === method && url.includes(fragment)
    })
    if (!key) {
      return Promise.resolve({ status: 404, body: { message: "Not Found" } })
    }
    const route = routes[key]
    return Promise.resolve().then(() =>
      typeof route === "function" ? route(url, payload) : route,
    )
  }

  return {
    calls,
    get: (url, headers) => handle("GET", url, headers),
    postJson: (url, payload, headers) => handle("POST", url, headers, payload),
    send: (method, url, headers) => handle(method, url, headers),
  }
}

function base64(text) {
  return Buffer.from(text, "utf8").toString("base64")
}

// An answer as returned by answers-requiring-attention
function answer({ id, userId, texts = [], checkboxes = [] }) {
  return {
    id,
    user_id: userId,
    data_json: {
      itemAnswers: [
        ...texts.map((textData) => ({ textData })),
        ...checkboxes.map(([quizItemId, checked]) => ({ quizItemId, checked })),
      ],
    },
  }
}

// Starts the app on a random port and returns its base URL and a close()
async function startServer(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function silenceConsoleErrors(t) {
  t.mock.method(console, "error", () => {})
}

module.exports = {
  fakeHttp,
  base64,
  answer,
  startServer,
  silenceConsoleErrors,
}
