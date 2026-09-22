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
  {
    id: "8b902358-a26a-5ac4-994c-ebc9bbf60910",
    name: "kubernetes",
    statusCourseId: "01651d2e-79fd-4afa-8f76-10850ace9c1c",
    tab: true,
  },
  {
    id: "83609a83-2022-4ed7-820c-79538604869e", // exercise id
    name: "stagemanagement",
    gha: true,
    susid: "a7a567d8-ff46-44db-a08e-26073bb07fc6", // course id
    ghid: "83609a83-2022-4ed7-820c-79538604869e", // exercise id
  },
  {
    id: "a57d8d10-39cc-46cf-935c-fa5f1dd9e686", //  exercise id
    name: "extension",
    gha: true,
    susid: "37e36bf4-f000-49c7-b420-965d8da82d92", // course id
    ghid: "a57d8d10-39cc-46cf-935c-fa5f1dd9e686", // exercise id
  },
  {
    id: "f6926cac-492d-4caf-a97f-5c2c8e776c19",
    name: "graphql",
    gha: true,
    susid: "d96d7ec8-4c2b-43fc-bf46-94ebb7fa4fe8",
    ghid: "f6926cac-492d-4caf-a97f-5c2c8e776c19",
  },
  {
    id: "8c8e45c1-e00e-4590-879d-5c7a1ed52c06",
    name: "typescript",
    gha: true,
    susid: "727b37dd-1ad7-4ffa-971c-d45671eef876",
    ghid: "8c8e45c1-e00e-4590-879d-5c7a1ed52c06",
  },
  {
    id: "27963151-686e-4218-bbc8-1e696e06cb41",
    name: "react native",
    qr: true,
  },
  {
    id: "114829c1-280e-4657-a9d2-1615d50956eb",
    name: "ci",
    gha: true,
    urls: true,
    linkCount: 2,
  },
  {
    id: "5eeb3678-c399-4211-8d71-09631d9c25d3",
    name: "containers",
    gha: true,
    urls: true,
    linkCount: 1,
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
  const match = url.match(
    /github\.com\/([^/]+)\/([^/\s#?]+)(?:\/tree\/[^/]+\/([^\s#?]+))?/,
  )
  if (!match) return null
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, ""),
    dir: match[3] ? match[3].replace(/\/+$/, "") : null,
  }
}

function readmePath(owner, repo, dir) {
  return dir
    ? `${GH_API_BASE}/repos/${owner}/${repo}/readme/${dir}`
    : `${GH_API_BASE}/repos/${owner}/${repo}/readme`
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

async function checkRepoExists(repoUrl) {
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
    const { status } = await httpsGet(
      `${GH_API_BASE}/repos/${owner}/${repo}`,
      headers,
    )
    if (status === 404) return false
    if (status === 200) return true
    console.error(
      `Repo existence check API error ${status} for ${owner}/${repo}`,
    )
    return null
  } catch (error) {
    console.error(
      `Repo existence check error for ${owner}/${repo}:`,
      error.message,
    )
    return null
  }
}

const QR_HINT_PATTERN =
  /qr[-_ ]?code|qrcode|c[oó]digo[-_ ]?qr|escane[oa]?.{0,20}\bqr\b|\bqr\b.{0,20}(escane|c[oó]digo)|api\.qrserver\.com|chart\.googleapis\.com\/chart\?cht=qr|quickchart\.io\/qr|qr\.expo\.dev|goqr\.me|qrcode-monkey|qrcode\.show|[(!\[][^)\]]*qr[-_.]?(code)?\.(png|jpe?g|gif|svg|webp)/i

async function checkReadmeHasQrCode(repoUrl) {
  const parsed = parseGitHubRepo(repoUrl)
  if (!parsed) return null
  const { owner, repo, dir } = parsed
  const token = process.env.GITHUB_TOKEN
  const headers = {
    "User-Agent": "crawler",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  try {
    const { status, body } = await httpsGet(
      readmePath(owner, repo, dir),
      headers,
    )
    if (status === 404) return false
    if (status !== 200 || !body || !body.content) {
      console.error(`QR check API error ${status} for ${owner}/${repo}`)
      return null
    }
    const text = Buffer.from(body.content, "base64").toString("utf8")
    return QR_HINT_PATTERN.test(text)
  } catch (error) {
    console.error(`QR check error for ${owner}/${repo}:`, error.message)
    return null
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
  const { owner, repo, dir } = parsed
  const token = process.env.GITHUB_TOKEN
  const headers = {
    "User-Agent": "crawler",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  try {
    const { body } = await httpsGet(readmePath(owner, repo, dir), headers)
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

async function getFlaggedCheaters(susid) {
  if (!susid) {
    return new Map()
  }

  try {
    const { status, body } = await httpsGet(
      `${MOOC_API_BASE}/courses/${susid}/suspected-cheaters?status=Flagged`,
      { Cookie: cookie },
    )

    if (status !== 200 || !Array.isArray(body)) {
      return new Map()
    }

    return new Map(
      body.map((entry) => [
        entry.user_id,
        {
          totalDurationSeconds: entry.total_duration_seconds,
          totalPoints: entry.total_points,
        },
      ]),
    )
  } catch (error) {
    console.error(`Suspected cheaters error for ${susid}:`, error.message)
    return new Map()
  }
}

async function getUserCoursePoints(statusCourseId, userId) {
  if (!statusCourseId || !userId) {
    return null
  }

  try {
    const { status, body } = await httpsGet(
      `${MOOC_API_BASE}/courses/${statusCourseId}/progress/${userId}`,
      { Cookie: cookie },
    )

    if (status !== 200 || !body) {
      return null
    }

    if (Array.isArray(body)) {
      const scores = body
        .map((entry) => entry?.score_given ?? entry?.scoreGiven)
        .map((rawScore) =>
          typeof rawScore === "number"
            ? rawScore
            : typeof rawScore === "string"
              ? Number(rawScore)
              : NaN,
        )
        .filter((score) => Number.isFinite(score))

      if (scores.length === 0) {
        return null
      }

      return scores.reduce((sum, score) => sum + score, 0)
    }

    if (typeof body === "object") {
      const rawScore = body.score_given ?? body.scoreGiven
      const numericScore =
        typeof rawScore === "number"
          ? rawScore
          : typeof rawScore === "string"
            ? Number(rawScore)
            : NaN

      return Number.isFinite(numericScore) ? numericScore : null
    }

    return null
  } catch (error) {
    console.error(
      `Course progress points error for ${statusCourseId}/${userId}:`,
      error.message,
    )
    return null
  }
}

async function getCourseUserPoints(statusCourseId, userIds) {
  if (!statusCourseId || userIds.length === 0) {
    return new Map()
  }

  const pointEntries = await Promise.all(
    userIds.map(async (userId) => [
      userId,
      await getUserCoursePoints(statusCourseId, userId),
    ]),
  )

  return new Map(pointEntries)
}

async function getUserDetailsForCourse(courseId, userId) {
  if (!courseId || !userId) {
    return null
  }

  try {
    const { status, body } = await httpsPostJson(
      `${MOOC_API_BASE}/user-details/user-by-courses`,
      {
        user_id: userId,
        course_ids: [courseId],
      },
      { Cookie: cookie },
    )

    if (status !== 200 || !body || typeof body !== "object") {
      return null
    }

    const firstName =
      typeof body.first_name === "string" ? body.first_name.trim() : ""
    const lastName =
      typeof body.last_name === "string" ? body.last_name.trim() : ""
    const name = `${firstName} ${lastName}`.trim()
    const email = typeof body.email === "string" ? body.email.trim() : ""

    return {
      name: name || null,
      email: email || null,
    }
  } catch (error) {
    console.error(
      `User details error for ${courseId}/${userId}:`,
      error.message,
    )
    return null
  }
}

async function getCourseUserDetails(courseId, userIds) {
  if (!courseId || userIds.length === 0) {
    return new Map()
  }

  const detailEntries = await Promise.all(
    userIds.map(async (userId) => [
      userId,
      await getUserDetailsForCourse(courseId, userId),
    ]),
  )

  return new Map(detailEntries)
}

async function fetchCourseData(course) {
  const answers = await fetchAllAnswers(course.id)
  const userIds = [
    ...new Set(answers.map((item) => item.user_id).filter(Boolean)),
  ]
  const [userPointsById, userDetailsById] = await Promise.all([
    getCourseUserPoints(course.statusCourseId, userIds),
    getCourseUserDetails(course.statusCourseId, userIds),
  ])

  for (const item of answers) {
    item._coursePoints = userPointsById.get(item.user_id) ?? null
    const details = userDetailsById.get(item.user_id)
    item._userName = details?.name ?? null
    item._userEmail = details?.email ?? null
  }

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

  await Promise.all(
    answers.map(async (item) => {
      const ghUrl = getItemTexts(item).find((text) =>
        text.includes("github.com"),
      )
      item._repoUrl = ghUrl ?? null
      item._repoExists = ghUrl ? await checkRepoExists(ghUrl) : null
    }),
  )

  if (course.qr) {
    await Promise.all(
      answers.map(async (item) => {
        item._qrExists = item._repoUrl
          ? await checkReadmeHasQrCode(item._repoUrl)
          : null
      }),
    )
  }

  if (course.linkCount) {
    for (const item of answers) {
      const readmeUrls = item._readmeUrls ?? []
      item._linksOk = item._repoUrl
        ? readmeUrls.length >= course.linkCount &&
          readmeUrls.some((url) => url.includes("github.com"))
        : null
    }
  }

  const cheaterCount = course.susid
    ? (await getFlaggedCheaters(course.susid)).size
    : null

  return {
    id: course.id,
    name: course.name,
    gha: !!course.gha,
    tab: !!course.tab,
    qr: !!course.qr,
    susid: course.susid ?? null,
    linkCount: course.linkCount ?? null,
    cheaterCount,
    answers,
  }
}

async function getSubmissionContent(submissionId) {
  try {
    const { status, body } = await httpsGet(
      `${MOOC_API_BASE}/exercise-slide-submissions/${submissionId}/info`,
      { Cookie: cookie },
    )

    if (status !== 200 || !body) {
      return null
    }

    const texts = getItemTexts({ tasks: body.tasks })
    return (
      texts.find((text) => text.includes("github.com")) ??
      texts.join(", ") ??
      null
    )
  } catch (error) {
    console.error(`Submission info error for ${submissionId}:`, error.message)
    return null
  }
}

async function getGhSubmissionsForUser(course, userId) {
  const ghExerciseId = course.ghid ?? course.id
  try {
    const { status, body } = await httpsGet(
      `${MOOC_API_BASE}/courses/${course.susid}/status-for-all-exercises/${userId}`,
      { Cookie: cookie },
    )

    if (status !== 200 || !Array.isArray(body)) {
      return []
    }

    const entry = body.find((item) => item.exercise?.id === ghExerciseId)
    const submissions = entry?.exercise_slide_submissions ?? []
    const contents = await Promise.all(
      submissions.map((submission) => getSubmissionContent(submission.id)),
    )
    return [...new Set(contents.filter(Boolean))]
  } catch (error) {
    console.error(
      `Status-for-all-exercises error for ${course.susid}/${userId}:`,
      error.message,
    )
    return []
  }
}

async function fetchCheatersData(course) {
  const flaggedCheaters = await getFlaggedCheaters(course.susid)
  const userIds = [...flaggedCheaters.keys()]
  const [userDetailsById, submissionsById] = await Promise.all([
    getCourseUserDetails(course.susid, userIds),
    Promise.all(
      userIds.map(async (userId) => [
        userId,
        await getGhSubmissionsForUser(course, userId),
      ]),
    ).then((entries) => new Map(entries)),
  ])

  const cheaters = userIds.map((userId) => {
    const info = flaggedCheaters.get(userId)
    const details = userDetailsById.get(userId)
    return {
      userId,
      name: details?.name ?? null,
      email: details?.email ?? null,
      durationMinutes: Math.round(info.totalDurationSeconds / 60),
      totalPoints: info.totalPoints,
      submissions: submissionsById.get(userId) ?? [],
    }
  })

  return { name: course.name, cheaters }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function renderAnswerCell(
  texts,
  readmeUrls = [],
  repoUrl = null,
  repoExists = null,
  qrExists = null,
  linksOk = null,
  minLinks = 2,
) {
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
      const missingBadge =
        text === repoUrl && repoExists === false
          ? ` <span class="repo-missing" title="Repository not found">no access</span>`
          : ""
      const qrBadge =
        text === repoUrl && qrExists === true
          ? ` <span class="qr-ok" title="QR code found in README">QR</span>`
          : text === repoUrl && qrExists === false
            ? ` <span class="qr-missing" title="No QR code found in README">QR</span>`
            : ""
      const linksRequirement =
        minLinks <= 1
          ? "a GitHub repo link"
          : `${minLinks}+ different links, including a GitHub repo link`
      const linksBadge =
        text === repoUrl && linksOk === true
          ? ` <span class="links-ok" title="README contains ${linksRequirement}">LINKS</span>`
          : text === repoUrl && linksOk === false
            ? ` <span class="links-missing" title="README needs ${linksRequirement}">LINKS</span>`
            : ""
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>${suffix}${missingBadge}${qrBadge}${linksBadge}`
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

function renderChecksCell(
  hasRepoUrl,
  repoExists,
  qrEnabled,
  qrExists,
  linksEnabled,
  linksOk,
  ghaEnabled,
  ghaConclusion,
) {
  const checks = []
  if (hasRepoUrl) {
    checks.push({ label: "Repo", ok: repoExists })
  }
  if (qrEnabled) {
    checks.push({ label: "QR", ok: qrExists })
  }
  if (linksEnabled) {
    checks.push({ label: "Links", ok: linksOk })
  }
  if (ghaEnabled) {
    checks.push({
      label: "GHA",
      ok: ghaConclusion ? ghaConclusion === "success" : null,
    })
  }

  if (checks.length === 0) {
    return "<td></td>"
  }

  const failed = checks.some((check) => check.ok === false)
  const unknown = checks.some((check) => check.ok === null)

  const cssClass = failed
    ? "checks-fail"
    : unknown
      ? "checks-unknown"
      : "checks-pass"
  const label = failed ? "FAIL" : unknown ? "?" : "PASS"
  const title = checks
    .map(
      (check) =>
        `${check.label}: ${check.ok === true ? "OK" : check.ok === false ? "missing" : "unknown"}`,
    )
    .join(", ")

  return `<td><span class="checks-badge ${cssClass}" title="${escapeHtml(title)}">${label}</span></td>`
}

function renderActionCell(
  itemId,
  exerciseId,
  userId = null,
  grade = null,
  hideFullPoints = false,
  hideCompletion = false,
  qrMissing = false,
  linksMissing = false,
  repoMissing = false,
  ghaFailed = false,
) {
  const fullPointsBtn = hideFullPoints
    ? ""
    : `<button class="grade-btn" data-action="FullPoints" data-user-id="${escapeHtml(itemId)}" data-exercise-id="${escapeHtml(exerciseId)}">Full points</button>`
  const completionBtn =
    hideCompletion || !userId
      ? ""
      : `<button class="grade-btn" data-action="Completion" data-user-id="${escapeHtml(userId)}" data-item-id="${escapeHtml(itemId)}" data-exercise-id="${escapeHtml(exerciseId)}" data-grade="${escapeHtml(grade ?? "")}">Completion</button>`
  const resetBtn = `<button class="grade-btn grade-btn-reset" data-action="Reset" data-user-id="${escapeHtml(itemId)}" data-exercise-id="${escapeHtml(exerciseId)}"${repoMissing ? ' data-repo-missing="true"' : ""}${ghaFailed ? ' data-gha-failed="true"' : ""}${qrMissing ? ' data-qr-missing="true"' : ""}${linksMissing ? ' data-links-missing="true"' : ""}>Reset</button>`

  const zeroPointsBtn = `<button class="grade-btn grade-btn-zero" data-action="ZeroPoints" data-user-id="${escapeHtml(itemId)}" data-exercise-id="${escapeHtml(exerciseId)}">Zero points</button>`

  let buttonOrder
  if (hideCompletion) {
    // Main page: Full points → Reset → Zero points
    buttonOrder = `${fullPointsBtn}${resetBtn}${zeroPointsBtn}`
  } else {
    // Tab view: Completion → Zero points → Reset → Full points
    buttonOrder = `${completionBtn}${zeroPointsBtn}${resetBtn}${fullPointsBtn}`
  }

  return `<td><span class="grade-actions">${buttonOrder}</span><span class="grade-result"></span></td>`
}

function calculateGrade(coursePoints) {
  if (typeof coursePoints !== "number" || !Number.isFinite(coursePoints)) {
    return null
  }

  if (coursePoints >= 49) return 5
  if (coursePoints >= 44) return 4
  if (coursePoints >= 39) return 3
  if (coursePoints >= 34) return 2
  if (coursePoints >= 29) return 1
  return 0
}

function renderCourseSection(
  courseResult,
  headingAsLink = false,
  showUserId = false,
) {
  const {
    id: exerciseId,
    name,
    gha,
    tab,
    qr,
    susid,
    linkCount,
    cheaterCount,
    answers,
  } = courseResult
  const headingText = `${escapeHtml(name)} <small>(${answers.length})</small>`
  const headingContent =
    headingAsLink && tab
      ? `<a href="/tab/${encodeURIComponent(exerciseId)}" target="_blank" rel="noopener noreferrer">${headingText}</a>`
      : headingText
  const cheaterBadge =
    cheaterCount !== null && cheaterCount > 0
      ? ` <span class="badge s-flagged"><a href="/cheaters/${encodeURIComponent(susid)}" target="_blank" rel="noopener noreferrer">${cheaterCount} flagged</a></span>`
      : ""

  let html = `<h2>${headingContent}${cheaterBadge}</h2>`

  if (answers.length === 0) {
    html += `<p class="none">No answers.</p>`
    return html
  }

  html += `<table><thead><tr>${showUserId ? "" : "<th>Answer ID</th>"}${showUserId ? "<th>User ID</th><th>Name</th><th>Email</th><th>Course points</th><th>Grade</th>" : ""}<th>Answer</th>${gha ? "<th>GHA status</th>" : ""}<th>Checks</th><th>Action</th></tr></thead><tbody>`
  for (const item of answers) {
    const texts = getItemTexts(item)
    const answerCell = renderAnswerCell(
      texts,
      linkCount ? [] : item._readmeUrls,
      item._repoUrl,
      item._repoExists,
      item._qrExists,
      item._linksOk,
      linkCount || 2,
    )
    const ghaCell = renderGhaCell(gha, item._ghaStatus)
    const userIdCell = showUserId ? `<td>${escapeHtml(item.user_id)}</td>` : ""
    const userNameCell =
      showUserId && item._userName !== null
        ? `<td>${escapeHtml(item._userName)}</td>`
        : showUserId
          ? "<td></td>"
          : ""
    const userEmailCell =
      showUserId && item._userEmail !== null
        ? `<td>${escapeHtml(item._userEmail)}</td>`
        : showUserId
          ? "<td></td>"
          : ""
    const pointsCell =
      showUserId && item._coursePoints !== null
        ? `<td>${escapeHtml(item._coursePoints)}</td>`
        : showUserId
          ? "<td></td>"
          : ""
    const grade = calculateGrade(item._coursePoints)
    const gradeCell =
      showUserId && grade !== null
        ? `<td>${escapeHtml(grade)}</td>`
        : showUserId
          ? "<td></td>"
          : ""
    const answerIdCell = showUserId ? "" : `<td>${escapeHtml(item.id)}</td>`
    const checksCell = renderChecksCell(
      !!item._repoUrl,
      item._repoExists,
      qr,
      item._qrExists,
      !!linkCount,
      item._linksOk,
      gha,
      item._ghaStatus?.conclusion,
    )
    const updatedActionCell = renderActionCell(
      item.id,
      exerciseId,
      item.user_id,
      grade,
      showUserId,
      !showUserId,
      item._qrExists === false,
      item._linksOk === false,
      !!item._repoUrl && item._repoExists === false,
      gha &&
        !!item._ghaStatus?.conclusion &&
        !["success", "rate limited", "error"].includes(
          item._ghaStatus.conclusion,
        ),
    )
    html += `<tr>${answerIdCell}${userIdCell}${userNameCell}${userEmailCell}${pointsCell}${gradeCell}<td>${answerCell}</td>${ghaCell}${checksCell}${updatedActionCell}</tr>`
  }
  html += `</tbody></table>`

  return html
}

function pageStyles(bodyStyle) {
  return `
    body { ${bodyStyle} }
    h2 { margin-top: 2rem; border-bottom: 1px solid #ccc; padding-bottom: 0.3rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
    th, td { text-align: left; padding: 0.4rem 0.6rem; border: 1px solid #ddd; }
    th { background: #f4f4f4; }
    a { color: #0969da; }
    .none { color: #888; font-style: italic; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600; color: #fff; }
    .badge a { color: #fff; text-decoration: none; }
    .checkbox-ok { color: #2da44e; font-weight: 600; }
    .checkbox-no { color: #888; }
    .repo-missing { color: #cf222e; font-weight: 600; }
    .qr-ok { color: #2da44e; font-weight: 600; }
    .qr-missing { color: #cf222e; font-weight: 600; }
    .links-ok { color: #2da44e; font-weight: 600; }
    .links-missing { color: #cf222e; font-weight: 600; }
    .checks-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600; color: #fff; }
    .checks-pass { background: #2da44e; }
    .checks-fail { background: #cf222e; }
    .checks-unknown { background: #888; }
    .s-success { background: #2da44e; }
    .s-failure, .s-timed_out { background: #cf222e; }
    .s-in_progress, .s-queued, .s-waiting, .s-action_required { background: #d4a017; color: #000; }
    .s-cancelled, .s-skipped, .s-no-runs, .s-error, .s-unknown, .s-n/a { background: #888; }
    .s-flagged { background: #cf222e; }
    .grade-actions { display: inline-flex; gap: 0.4rem; }
    .grade-btn { border: 1px solid #ccc; background: #fff; border-radius: 6px; padding: 0.3rem 0.6rem; cursor: pointer; }
    .grade-btn-zero { border-color: #cf222e; color: #cf222e; }
    .grade-btn-green { border-color: #2da44e; color: #2da44e; }
    .grade-btn-reset { border-color: #d4a017; color: #9a6700; }
    .grade-btn-selected { background: #2da44e; border-color: #2da44e; color: #fff; }
    .grade-btn-zero.grade-btn-selected { background: #cf222e; border-color: #cf222e; color: #fff; }
    .grade-btn-green.grade-btn-selected { background: #2da44e; border-color: #2da44e; color: #fff; }
    .grade-btn-reset.grade-btn-selected { background: #d4a017; border-color: #d4a017; color: #000; }
    .grade-btn:disabled { opacity: 0.6; cursor: default; }
    .grade-result { margin-left: 0.5rem; font-size: 0.85rem; color: #555; }
    .grade-ok { color: #2da44e; }
    .grade-fail { color: #cf222e; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal-overlay[hidden] { display: none; }
    .modal { background: #fff; border-radius: 8px; padding: 1.5rem; width: 90%; max-width: 420px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25); }
    .modal h3 { margin-top: 0; }
    .modal select, .modal textarea { width: 100%; margin-top: 0.4rem; margin-bottom: 1rem; padding: 0.4rem; box-sizing: border-box; font-family: inherit; font-size: 0.9rem; }
    .modal textarea { min-height: 4.5rem; resize: vertical; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
  `
}

function renderCheatersPage(courseName, cheaters, susid) {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Suspected cheaters - ${escapeHtml(courseName)}</title>
  <style>${pageStyles(
    "font-family: sans-serif; margin: 1rem; padding: 0;",
  )}</style>
</head>
<body>
<h1>Suspected cheaters <small>(${escapeHtml(courseName)})</small></h1>`

  if (cheaters.length === 0) {
    html += `<p class="none">No flagged users.</p>`
  } else {
    html += `<table><thead><tr><th>User ID</th><th>Name</th><th>Email</th><th>Duration (min)</th><th>Points</th><th>GH exercise submissions</th><th>Action</th></tr></thead><tbody>`
    for (const cheater of cheaters) {
      const submissionsCell =
        cheater.submissions.length === 0
          ? ""
          : cheater.submissions
              .map((content) => {
                const safeContent = escapeHtml(content)
                return content.startsWith("http")
                  ? `<a href="${safeContent}" target="_blank" rel="noopener noreferrer">${safeContent}</a>`
                  : safeContent
              })
              .join("<br>")
      const actionCell = `<td><button class="grade-btn grade-btn-green cheater-action-btn" data-action="dismiss" data-user-id="${escapeHtml(cheater.userId)}">Honest</button><button class="grade-btn grade-btn-zero cheater-action-btn" data-action="confirm" data-user-id="${escapeHtml(cheater.userId)}">CHEATER</button><span class="grade-result"></span></td>`
      html += `<tr><td>${escapeHtml(cheater.userId)}</td><td>${escapeHtml(cheater.name ?? "")}</td><td>${escapeHtml(cheater.email ?? "")}</td><td>${escapeHtml(cheater.durationMinutes)}</td><td>${escapeHtml(cheater.totalPoints)}</td><td>${submissionsCell}</td>${actionCell}</tr>`
    }
    html += `</tbody></table>`
  }

  html += `<script>
    document.addEventListener("click", async (event) => {
      const button = event.target.closest(".cheater-action-btn")
      if (!button) return

      const action = button.dataset.action
      const endpoint = action === "confirm" ? "/confirm-cheater" : "/dismiss-cheater"
      const confirmMessage =
        action === "confirm"
          ? "Confirm this user as a cheater?"
          : "Mark this user as honest?"

      const confirmed = window.confirm(confirmMessage)
      if (!confirmed) return

      const userId = button.dataset.userId
      const actionCell = button.closest("td")
      const result = actionCell?.querySelector(".grade-result")
      const buttons = actionCell ? actionCell.querySelectorAll(".cheater-action-btn") : [button]

      buttons.forEach((btn) => {
        btn.disabled = true
      })
      if (result) {
        result.textContent = "sending..."
        result.className = "grade-result"
      }

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ susid: ${JSON.stringify(susid)}, userId }),
        })
        const data = await response.json()
        if (response.ok && data.ok) {
          if (result) {
            result.textContent = action === "confirm" ? "confirmed" : "honest"
            result.classList.add("grade-ok")
          }
        } else {
          buttons.forEach((btn) => {
            btn.disabled = false
          })
          if (result) {
            result.textContent = data?.error || ("failed (" + response.status + ")")
            result.classList.add("grade-fail")
          }
        }
      } catch (err) {
        buttons.forEach((btn) => {
          btn.disabled = false
        })
        if (result) {
          result.textContent = err.message
          result.classList.add("grade-fail")
        }
      }
    })
  </script>`

  html += `</body></html>`
  return html
}

function renderPage(results, options = {}) {
  const {
    headingAsLink = true,
    showUserId = false,
    compactLayout = false,
  } = options
  const bodyStyle = compactLayout
    ? "font-family: sans-serif; margin: 1rem; padding: 0;"
    : "font-family: sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem;"
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Answers requiring attention</title>
  <style>${pageStyles(bodyStyle)}</style>
</head>
<body>
<h1>Answers requiring attention</h1>`

  for (const courseResult of results) {
    if (courseResult.tab && !showUserId) {
      // For tab-only courses on main page, just show a link instead of listing answers
      const linkText = `${escapeHtml(courseResult.name)} <small>(${courseResult.answers.length})</small>`
      html += `<h2><a href="/tab/${encodeURIComponent(courseResult.id)}" target="_blank" rel="noopener noreferrer">${linkText}</a></h2>`
    } else {
      html += renderCourseSection(courseResult, headingAsLink, showUserId)
    }
  }

  html += `<div id="reset-modal-overlay" class="modal-overlay" hidden>
    <div class="modal">
      <h3>Reset exercise</h3>
      <label for="reset-reason-select">Reason</label>
      <select id="reset-reason-select">
        <option value="repository must be accessible by user mluukkai">repository must be accessible by user mluukkai</option>
        <option value="tests must pass in GitHub">tests must pass in GitHub</option>
        <option value="QR-code missing">QR-code missing</option>
        <option value="README.md does not contain the required links">README.md does not contain the required links</option>
        <option value="__other__">Other (write below)</option>
      </select>
      <textarea id="reset-reason-text" placeholder="Justification" hidden></textarea>
      <div class="modal-actions">
        <button type="button" id="reset-modal-cancel" class="grade-btn">Cancel</button>
        <button type="button" id="reset-modal-submit" class="grade-btn grade-btn-zero">Submit reset</button>
      </div>
    </div>
  </div>
  <script>
    let pendingReset = null

    function openResetModal(userExerciseStateId, exerciseId, button) {
      pendingReset = { userExerciseStateId, exerciseId, button }
      const select = document.getElementById("reset-reason-select")
      const textarea = document.getElementById("reset-reason-text")
      select.value =
        button.dataset.repoMissing === "true"
          ? "repository must be accessible by user mluukkai"
          : button.dataset.ghaFailed === "true"
            ? "tests must pass in GitHub"
            : button.dataset.qrMissing === "true"
              ? "QR-code missing"
              : button.dataset.linksMissing === "true"
                ? "README.md does not contain the required links"
                : select.options[0].value
      textarea.value = ""
      textarea.hidden = true
      document.getElementById("reset-modal-overlay").hidden = false
    }

    function closeResetModal() {
      pendingReset = null
      document.getElementById("reset-modal-overlay").hidden = true
    }

    document.getElementById("reset-reason-select").addEventListener("change", (event) => {
      document.getElementById("reset-reason-text").hidden = event.target.value !== "__other__"
    })

    document.getElementById("reset-modal-cancel").addEventListener("click", () => {
      closeResetModal()
    })

    document.getElementById("reset-modal-submit").addEventListener("click", async () => {
      if (!pendingReset) return
      const select = document.getElementById("reset-reason-select")
      const textarea = document.getElementById("reset-reason-text")
      const justification = select.value === "__other__" ? textarea.value.trim() : select.value
      if (!justification) {
        textarea.focus()
        return
      }

      const { userExerciseStateId, exerciseId, button } = pendingReset
      const actionCell = button.closest("td")
      const result = actionCell?.querySelector(".grade-result")
      const buttons = actionCell ? actionCell.querySelectorAll(".grade-btn") : [button]

      closeResetModal()

      buttons.forEach((btn) => {
        btn.disabled = true
      })
      if (result) {
        result.textContent = "sending..."
        result.className = "grade-result"
      }

      try {
        const response = await fetch("/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_exercise_state_id: userExerciseStateId,
            exercise_id: exerciseId,
            action: "Other",
            justification,
          }),
        })

        const data = await response.json()
        if (response.ok && data.ok) {
          if (result) {
            result.textContent = "reset"
            result.classList.add("grade-ok")
          }
          buttons.forEach((btn) => {
            btn.classList.remove("grade-btn-selected")
          })
          button.classList.add("grade-btn-selected")
        } else {
          const msg = data?.error || data?.body?.error || ("failed (" + response.status + ")")
          if (result) {
            result.textContent = msg
            result.classList.add("grade-fail")
          }
        }
      } catch (err) {
        if (result) {
          result.textContent = err.message
          result.classList.add("grade-fail")
        }
      } finally {
        buttons.forEach((btn) => {
          btn.disabled = false
        })
      }
    })

    document.addEventListener("click", async (event) => {
      const button = event.target.closest(".grade-btn")
      if (!button || !button.dataset.action) return

      const userExerciseStateId = button.dataset.userId
      const itemId = button.dataset.itemId
      const exerciseId = button.dataset.exerciseId
      const action = button.dataset.action
      const grade = button.dataset.grade

      if (action === "Reset") {
        openResetModal(userExerciseStateId, exerciseId, button)
        return
      }

      if (action === "ZeroPoints") {
        const confirmed = window.confirm("Set this submission to zero points?")
        if (!confirmed) return
      }

      if (action === "Completion") {
        const confirmed = window.confirm("Submit completion for this user?")
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
        let allOk = true

        if (action === "Completion") {
          console.log("Completion button clicked", { userExerciseStateId, itemId, exerciseId, grade })
          // First, submit completion
          const today = new Date()
          const completionDate = today.toISOString().replace('Z', '+00:00')
          const completionPayload = {
            user_id: userExerciseStateId,
            grade: parseInt(grade) || 0,
            completion_date: completionDate,
          }

          const completionResponse = await fetch("/completion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(completionPayload),
          })

          const completionData = await completionResponse.json()
          if (!completionResponse.ok || !completionData.ok) {
            allOk = false
            const completionError = completionData?.error || completionData?.body?.error || ("completion failed (" + completionResponse.status + ")")
            console.error("Completion failed:", completionError, completionData)
          }

          // Then, submit full points grading
          const gradePayload = {
            user_exercise_state_id: itemId,
            exercise_id: exerciseId,
            action: "FullPoints",
          }

          console.log("About to post grading with payload:", gradePayload)

          const gradeResponse = await fetch("/grade", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(gradePayload),
          })

          const gradeData = await gradeResponse.json()
          console.log("Grade response:", gradeResponse.status, gradeData)
          if (!gradeResponse.ok || !gradeData.ok) {
            allOk = false
            const gradeError = gradeData?.error || gradeData?.body?.error || ("grade failed (" + gradeResponse.status + ")")
            result.textContent = gradeError
            result.classList.add("grade-fail")
          }

          if (allOk) {
            result.textContent = "ok"
            result.classList.add("grade-ok")
            buttons.forEach((btn) => {
              btn.classList.remove("grade-btn-selected")
            })
            button.classList.add("grade-btn-selected")
          }
        } else {
          // Original grading flow for FullPoints/ZeroPoints
          const payload = {
            user_exercise_state_id: userExerciseStateId,
            exercise_id: exerciseId,
            action,
          }

          const response = await fetch("/grade", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
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
    const { user_exercise_state_id, exercise_id, action, justification } =
      req.body || {}
    if (!user_exercise_state_id || !exercise_id) {
      return res
        .status(400)
        .json({ error: "Missing user_exercise_state_id or exercise_id" })
    }
    const isKnownExercise = courses.some((course) => course.id === exercise_id)
    if (!isKnownExercise) {
      return res.status(400).json({ error: "Unknown exercise_id" })
    }

    const allowedActions = new Set(["FullPoints", "ZeroPoints", "Other"])
    const selectedAction = allowedActions.has(action) ? action : "FullPoints"

    if (selectedAction === "Other" && !justification) {
      return res.status(400).json({ error: "Missing justification" })
    }

    const payload = {
      user_exercise_state_id,
      exercise_id,
      action: selectedAction,
      manual_points: null,
      justification: selectedAction === "Other" ? justification : null,
      hidden: false,
      reset_exercise: selectedAction === "Other",
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
    res.send(
      renderPage(results, {
        headingAsLink: true,
        showUserId: false,
        compactLayout: false,
      }),
    )
  } catch (err) {
    res.status(500).send(`<pre>${err.message}</pre>`)
  }
})

app.post("/completion", async (req, res) => {
  try {
    const { user_id, grade, completion_date } = req.body || {}
    if (!user_id) {
      return res.status(400).json({ error: "Missing user_id" })
    }

    const payload = {
      course_module_id: "9c648dca-9a49-5ba8-ad3d-67848b641fd6",
      new_completions: [
        {
          user_id,
          grade: typeof grade === "number" ? grade : 0,
          completion_date: completion_date || new Date().toISOString(),
          passed: (grade ?? 0) >= 1,
        },
      ],
      skip_duplicate_completions: false,
    }

    const response = await httpsPostJson(
      "https://courses.mooc.fi/api/v0/main-frontend/course-instances/e0215028-f31f-4e93-8f5b-4d38eaa504a6/completions",
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

app.get("/cheaters/:susid", async (req, res) => {
  try {
    const { susid } = req.params
    const course = courses.find((item) => item.susid === susid)
    if (!course) {
      return res.status(404).send("<pre>Course not found</pre>")
    }

    const { name, cheaters } = await fetchCheatersData(course)
    res.send(renderCheatersPage(name, cheaters, susid))
  } catch (err) {
    res.status(500).send(`<pre>${err.message}</pre>`)
  }
})

async function handleCheaterAction(req, res, action) {
  try {
    const { susid, userId } = req.body || {}
    if (!susid || !userId) {
      return res.status(400).json({ error: "Missing susid or userId" })
    }
    const isKnownCourse = courses.some((course) => course.susid === susid)
    if (!isKnownCourse) {
      return res.status(400).json({ error: "Unknown susid" })
    }

    const response = await httpsPostJson(
      `${MOOC_API_BASE}/courses/${susid}/suspected-cheaters/${action}/${userId}`,
      {},
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
}

app.post("/dismiss-cheater", (req, res) =>
  handleCheaterAction(req, res, "dismiss"),
)
app.post("/confirm-cheater", (req, res) =>
  handleCheaterAction(req, res, "confirm"),
)

app.get("/tab/:exerciseId", async (req, res) => {
  try {
    const { exerciseId } = req.params
    const course = courses.find((item) => item.id === exerciseId && item.tab)
    if (!course) {
      return res.status(404).send("<pre>Tab course not found</pre>")
    }

    const result = await fetchCourseData(course)
    res.send(
      renderPage([result], {
        headingAsLink: false,
        showUserId: true,
        compactLayout: true,
      }),
    )
  } catch (err) {
    res.status(500).send(`<pre>${err.message}</pre>`)
  }
})

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
