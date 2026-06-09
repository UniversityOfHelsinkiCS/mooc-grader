require("dotenv").config()
const fs = require("fs")
const https = require("https")
const express = require("express")

const app = express()
app.use(express.json())

const PORT = 3033
const MOOC_API_BASE = "https://courses.mooc.fi/api/v0/main-frontend"
const GH_API_BASE = "https://api.github.com"

const courses = [
  { id: "f6926cac-492d-4caf-a97f-5c2c8e776c19", name: "graphql", gha: true },
  { id: "8c8e45c1-e00e-4590-879d-5c7a1ed52c06", name: "typescript", gha: true },
  { id: "27963151-686e-4218-bbc8-1e696e06cb41", name: "react native" },
  {
    id: "114829c1-280e-4657-a9d2-1615d50956eb",
    name: "ci",
    gha: true,
    urls: true,
  },
  {
    id: "5eeb3678-c399-4211-8d71-09631d9c25d3",
    name: "containers",
    gha: true,
    urls: true,
  },
  { id: "6701a725-2daa-4cff-80be-0bc3ac0d721f", name: "psql", gha: true },
  { id: "f6e41e7c-fb88-46fd-b013-890219cb86a6", name: "nextjs", gha: true },
]

const cookie = fs.readFileSync("cookie", "utf8").trim()
const limit = 50

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

function httpRequest(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const options = {
      method,
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      headers,
    }

    const req = https.request(options, (res) => {
      if (isRedirectStatus(res.statusCode) && res.headers.location) {
        return httpRequest(method, res.headers.location, headers, body)
          .then(resolve)
          .catch(reject)
      }

      let data = ""
      res.on("data", (chunk) => (data += chunk))
      res.on("end", () => {
        resolve({ status: res.statusCode, body: tryParseJson(data) })
      })
    })

    req.on("error", reject)
    if (body) {
      req.write(body)
    }
    req.end()
  })
}

function httpsGet(url, headers = {}) {
  return httpRequest("GET", url, headers)
}

function httpsPostJson(url, payloadObject, headers = {}) {
  const payload = JSON.stringify(payloadObject)
  return httpRequest(
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

function fetchPage(exerciseId, page) {
  const url = `${MOOC_API_BASE}/exercises/${exerciseId}/answers-requiring-attention?page=${page}&limit=${limit}`
  return httpsGet(url, { Cookie: cookie }).then((r) => r.body)
}

function parseGitHubRepo(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/\s#?]+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") }
}

async function getGhaStatus(repoUrl) {
  const parsed = parseGitHubRepo(repoUrl)
  if (!parsed) return null
  const { owner, repo } = parsed
  const token = process.env.GITHUB_TOKEN
  const headers = {
    "User-Agent": "crawler",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  try {
    const { status, body } = await httpsGet(
      `${GH_API_BASE}/repos/${owner}/${repo}/actions/runs?per_page=30`,
      headers,
    )

    // Check for rate limiting or other API errors
    if (status === 403 && body.message?.includes("rate limit")) {
      console.error(`Rate limit exceeded for ${owner}/${repo}`)
      return { conclusion: "rate limited", branch: null }
    }

    if (status !== 200) {
      console.error(
        `API error ${status} for ${owner}/${repo}:`,
        body.message || body,
      )
      return { conclusion: "error", branch: null }
    }

    if (!body.workflow_runs || body.workflow_runs.length === 0) {
      return { conclusion: "no runs", branch: null }
    }

    // Find the first non-scheduled workflow run (exclude scheduled events and health-check workflows)
    const run = body.workflow_runs.find((run) => {
      if (run.event === "schedule") return false
      const workflowName = run.path || run.name || ""
      if (
        workflowName.includes("health-check") ||
        workflowName.includes("periodic")
      )
        return false
      return true
    })

    if (!run) {
      return { conclusion: "no runs", branch: null }
    }

    return { conclusion: run.conclusion ?? run.status, branch: run.head_branch }
  } catch (error) {
    console.error(`GHA error for ${owner}/${repo}:`, error.message)
    return { conclusion: "error", branch: null }
  }
}

async function fetchAllAnswers(exerciseId) {
  const first = await fetchPage(exerciseId, 1)
  const totalPages = first.total_pages ?? 1
  const allData = [...first.data]
  for (let page = 2; page <= totalPages; page++) {
    const result = await fetchPage(exerciseId, page)
    allData.push(...result.data)
  }
  return allData
}

function getQuizItemTitleMap(item) {
  return Object.fromEntries(
    (item.tasks ?? [])
      .flatMap((task) => task.public_spec?.items ?? [])
      .map((quizItem) => [quizItem.id, quizItem.title]),
  )
}

function formatItemAnswer(answer, quizItemTitles) {
  if (typeof answer.textData === "string" && answer.textData.trim()) {
    return answer.textData.trim()
  }

  if (typeof answer.checked === "boolean") {
    const title = quizItemTitles[answer.quizItemId] ?? answer.quizItemId
    return `${answer.checked ? "__CHECKED__" : "__UNCHECKED__"}:${title}`
  }

  return null
}

function getItemTexts(item) {
  const quizItemTitles = getQuizItemTitleMap(item)
  const taskAnswers = (item.tasks ?? []).flatMap(
    (task) => task.previous_submission?.data_json?.itemAnswers ?? [],
  )
  const itemAnswers = item.data_json?.itemAnswers ?? []

  return [
    ...new Set(
      [...itemAnswers, ...taskAnswers]
        .map((answer) => formatItemAnswer(answer, quizItemTitles))
        .filter(Boolean),
    ),
  ]
}

async function getReadmeUrls(repoUrl) {
  const parsed = parseGitHubRepo(repoUrl)
  if (!parsed) return []
  const { owner, repo } = parsed
  const token = process.env.GITHUB_TOKEN
  const headers = {
    "User-Agent": "crawler",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  try {
    const { body } = await httpsGet(
      `${GH_API_BASE}/repos/${owner}/${repo}/readme`,
      headers,
    )
    if (!body || !body.content) return []
    const text = Buffer.from(body.content, "base64").toString("utf8")

    // Extract URLs from markdown links [text](url) and plain URLs
    const urls = new Set()

    // Match markdown links: [text](url)
    const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
    let match
    while ((match = mdLinkRegex.exec(text)) !== null) {
      const url = match[2].trim()
      if (url.startsWith("http://") || url.startsWith("https://")) {
        urls.add(url)
      }
    }

    // Also match plain URLs in text
    const plainUrlRegex = /https?:\/\/[^\s<>"'`]+/g
    const plainMatches = text.match(plainUrlRegex) || []
    plainMatches.forEach((url) => urls.add(url))

    return Array.from(urls)
  } catch (error) {
    console.error(`README error for ${owner}/${repo}:`, error.message)
    return []
  }
}

async function fetchCourseData(course) {
  const answers = await fetchAllAnswers(course.id)
  if (course.gha) {
    await Promise.all(
      answers.map(async (item) => {
        const ghUrl = getItemTexts(item).find((text) =>
          text.includes("github.com"),
        )
        item._ghaStatus = ghUrl ? await getGhaStatus(ghUrl) : null
      }),
    )
  }
  if (course.urls) {
    await Promise.all(
      answers.map(async (item) => {
        const ghUrl = getItemTexts(item).find((text) =>
          text.includes("github.com"),
        )
        item._readmeUrls = ghUrl ? await getReadmeUrls(ghUrl) : []
      }),
    )
  }

  return {
    id: course.id,
    name: course.name,
    gha: !!course.gha,
    answers,
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function renderAnswerCell(texts, readmeUrls = []) {
  const checkedItems = texts.filter((text) => text.startsWith("__CHECKED__:"))
  const uncheckedItems = texts.filter((text) =>
    text.startsWith("__UNCHECKED__:"),
  )
  const plainTexts = texts.filter(
    (text) =>
      !text.startsWith("__CHECKED__:") && !text.startsWith("__UNCHECKED__:"),
  )

  const renderedTexts = plainTexts.map((text, index) => {
    const suffix =
      index === plainTexts.length - 1 && checkedItems.length > 0
        ? ` <span class="checkbox-ok" title="${escapeHtml(checkedItems.map((text) => text.replace("__CHECKED__:", "")).join(", "))}">✓</span>`
        : ""

    if (text.startsWith("http")) {
      const safeUrl = escapeHtml(text)
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>${suffix}`
    }

    return `${escapeHtml(text)}${suffix}`
  })

  if (renderedTexts.length === 0 && checkedItems.length > 0) {
    renderedTexts.push(
      `<span class="checkbox-ok" title="${escapeHtml(checkedItems.map((text) => text.replace("__CHECKED__:", "")).join(", "))}">✓</span>`,
    )
  }

  renderedTexts.push(
    ...uncheckedItems.map((text) => {
      const label = escapeHtml(text.replace("__UNCHECKED__:", ""))
      return `<span class="checkbox-no" title="${label}">○</span>`
    }),
  )

  let html = renderedTexts.join("<br>")
  if (readmeUrls.length > 0) {
    html +=
      "<br><strong>README URLs:</strong><br>" +
      readmeUrls
        .map((url) => {
          const safeUrl = escapeHtml(url)
          return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`
        })
        .join("<br>")
  }
  return html
}

function renderGhaCell(ghaEnabled, status) {
  if (!ghaEnabled) {
    return ""
  }

  const label = status ? status.conclusion : "n/a"
  const cssClass = label ? label.replace(/\s+/g, "-").toLowerCase() : "unknown"
  const branchText = status?.branch ? ` (${escapeHtml(status.branch)})` : ""
  return `<td><span class="badge s-${cssClass}">${escapeHtml(label)}${branchText}</span></td>`
}

function renderActionCell(itemId, exerciseId) {
  return `<td><span class="grade-actions"><button class="grade-btn" data-action="FullPoints" data-user-id="${escapeHtml(itemId)}" data-exercise-id="${escapeHtml(exerciseId)}">Full points</button><button class="grade-btn grade-btn-zero" data-action="ZeroPoints" data-user-id="${escapeHtml(itemId)}" data-exercise-id="${escapeHtml(exerciseId)}">Zero points</button></span><span class="grade-result"></span></td>`
}

function renderPage(results) {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Answers requiring attention</title>
  <style>
    body { font-family: sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    h2 { margin-top: 2rem; border-bottom: 1px solid #ccc; padding-bottom: 0.3rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
    th, td { text-align: left; padding: 0.4rem 0.6rem; border: 1px solid #ddd; }
    th { background: #f4f4f4; }
    a { color: #0969da; }
    .none { color: #888; font-style: italic; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600; color: #fff; }
    .checkbox-ok { color: #2da44e; font-weight: 600; }
    .checkbox-no { color: #888; }
    .s-success { background: #2da44e; }
    .s-failure, .s-timed_out { background: #cf222e; }
    .s-in_progress, .s-queued, .s-waiting, .s-action_required { background: #d4a017; color: #000; }
    .s-cancelled, .s-skipped, .s-no-runs, .s-error, .s-unknown, .s-n/a { background: #888; }
    .grade-actions { display: inline-flex; gap: 0.4rem; }
    .grade-btn { border: 1px solid #ccc; background: #fff; border-radius: 6px; padding: 0.3rem 0.6rem; cursor: pointer; }
    .grade-btn-zero { border-color: #cf222e; color: #cf222e; }
    .grade-btn-selected { background: #2da44e; border-color: #2da44e; color: #fff; }
    .grade-btn-zero.grade-btn-selected { background: #cf222e; border-color: #cf222e; color: #fff; }
    .grade-btn:disabled { opacity: 0.6; cursor: default; }
    .grade-result { margin-left: 0.5rem; font-size: 0.85rem; color: #555; }
    .grade-ok { color: #2da44e; }
    .grade-fail { color: #cf222e; }
  </style>
</head>
<body>
<h1>Answers requiring attention</h1>`

  for (const { id: exerciseId, name, gha, answers } of results) {
    html += `<h2>${escapeHtml(name)} <small>(${answers.length})</small></h2>`

    if (answers.length === 0) {
      html += `<p class="none">No answers.</p>`
      continue
    }

    html += `<table><thead><tr><th>Answer ID</th><th>Answer</th>${gha ? "<th>GHA status</th>" : ""}<th>Action</th></tr></thead><tbody>`
    for (const item of answers) {
      const texts = getItemTexts(item)
      const answerCell = renderAnswerCell(texts, item._readmeUrls)
      const ghaCell = renderGhaCell(gha, item._ghaStatus)
      const actionCell = renderActionCell(item.id, exerciseId)
      html += `<tr><td>${escapeHtml(item.id)}</td><td>${answerCell}</td>${ghaCell}${actionCell}</tr>`
    }
    html += `</tbody></table>`
  }

  html += `<script>
    document.addEventListener("click", async (event) => {
      const button = event.target.closest(".grade-btn")
      if (!button) return

      const userExerciseStateId = button.dataset.userId
      const exerciseId = button.dataset.exerciseId
      const action = button.dataset.action || "FullPoints"

      if (action === "ZeroPoints") {
        const confirmed = window.confirm("Set this submission to zero points?")
        if (!confirmed) return
      }

      const actionCell = button.closest("td")
      const result = actionCell?.querySelector(".grade-result")
      const buttons = actionCell ? actionCell.querySelectorAll(".grade-btn") : [button]

      buttons.forEach((btn) => {
        btn.disabled = true
      })
      if (!result) return
      result.textContent = "sending..."
      result.className = "grade-result"

      try {
        const response = await fetch("/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_exercise_state_id: userExerciseStateId,
            exercise_id: exerciseId,
            action,
          }),
        })

        const data = await response.json()
        if (response.ok && data.ok) {
          result.textContent = "ok"
          result.classList.add("grade-ok")
          buttons.forEach((btn) => {
            btn.classList.remove("grade-btn-selected")
          })
          button.classList.add("grade-btn-selected")
        } else {
          const msg = data?.error || data?.body?.error || ("failed (" + response.status + ")")
          result.textContent = msg
          result.classList.add("grade-fail")
        }
      } catch (err) {
        result.textContent = err.message
        result.classList.add("grade-fail")
      } finally {
        buttons.forEach((btn) => {
          btn.disabled = false
        })
      }
    })
  </script></body></html>`

  return html
}

app.post("/grade", async (req, res) => {
  try {
    const { user_exercise_state_id, exercise_id, action } = req.body || {}
    if (!user_exercise_state_id || !exercise_id) {
      return res
        .status(400)
        .json({ error: "Missing user_exercise_state_id or exercise_id" })
    }
    const isKnownExercise = courses.some((course) => course.id === exercise_id)
    if (!isKnownExercise) {
      return res.status(400).json({ error: "Unknown exercise_id" })
    }

    const allowedActions = new Set(["FullPoints", "ZeroPoints"])
    const selectedAction = allowedActions.has(action) ? action : "FullPoints"

    const payload = {
      user_exercise_state_id,
      exercise_id,
      action: selectedAction,
      manual_points: null,
      justification: null,
      hidden: false,
    }

    const response = await httpsPostJson(
      `${MOOC_API_BASE}/teacher-grading-decisions`,
      payload,
      { Cookie: cookie },
    )

    if (response.status >= 200 && response.status < 300) {
      return res.json({
        ok: true,
        status: response.status,
        body: response.body,
      })
    }

    return res.status(response.status || 500).json({
      ok: false,
      status: response.status,
      body: response.body,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

app.get("/", async (req, res) => {
  try {
    const results = await Promise.all(courses.map(fetchCourseData))
    res.send(renderPage(results))
  } catch (err) {
    res.status(500).send(`<pre>${err.message}</pre>`)
  }
})

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
