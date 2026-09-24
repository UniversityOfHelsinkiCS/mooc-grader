const { getItemTexts } = require("../domain/answers")
const { calculateGrade } = require("../domain/grading")
const { isGhaFailed, isGhaPassing } = require("../domain/repository")
const { escapeHtml, externalLink, layout } = require("./html")
const {
  renderAnswerCell,
  renderGhaCell,
  renderChecksCell,
  renderActionCell,
} = require("./cells")

const RESET_REASONS = [
  "repository must be accessible by user mluukkai",
  "tests must pass in GitHub",
  "QR-code missing",
  "README.md does not contain the required links",
]

function answerChecks(item, { qr, gha, linkCount }) {
  const checks = []
  if (item._repoUrl) {
    checks.push({ label: "Repo", ok: item._repoExists })
  }
  if (qr) {
    checks.push({ label: "QR", ok: item._qrExists })
  }
  if (linkCount) {
    checks.push({ label: "Links", ok: item._linksOk })
  }
  if (gha) {
    checks.push({ label: "GHA", ok: isGhaPassing(item._ghaStatus?.conclusion) })
  }
  return checks
}

function optionalCell(show, value) {
  if (!show) return ""
  return value !== null && value !== undefined
    ? `<td>${escapeHtml(value)}</td>`
    : "<td></td>"
}

function renderAnswerRow(item, courseResult, completionTabId) {
  const { exerciseId, gha, linkCount } = courseResult
  const grade = calculateGrade(item._coursePoints)

  const answerCell = renderAnswerCell(getItemTexts(item), {
    repoUrl: item._repoUrl,
    repoExists: item._repoExists,
    qrExists: item._qrExists,
    linksOk: item._linksOk,
    minLinks: linkCount || 2,
  })
  const actionCell = renderActionCell({
    itemId: item.id,
    exerciseId,
    userId: item.user_id,
    grade,
    completionTabId,
    qrMissing: item._qrExists === false,
    linksMissing: item._linksOk === false,
    repoMissing: !!item._repoUrl && item._repoExists === false,
    ghaFailed: gha && isGhaFailed(item._ghaStatus?.conclusion),
  })

  const userCells = completionTabId
    ? [
        optionalCell(true, item.user_id),
        optionalCell(true, item._userName),
        optionalCell(true, item._userEmail),
        optionalCell(true, item._coursePoints),
        optionalCell(true, grade),
      ].join("")
    : `<td>${escapeHtml(item.id)}</td>`

  return `<tr>${userCells}<td>${answerCell}</td>${renderGhaCell(gha, item._ghaStatus)}${renderChecksCell(answerChecks(item, courseResult))}${actionCell}</tr>`
}

function renderCourseSection(courseResult, completionTabId, basePath) {
  const { name, gha, courseId, cheaterCount, answers } = courseResult
  const cheaterBadge =
    cheaterCount !== null && cheaterCount > 0
      ? ` <span class="badge s-flagged">${externalLink(`${basePath}/cheaters/${encodeURIComponent(courseId)}`, `${cheaterCount} flagged`)}</span>`
      : ""

  let html = `<h2>${escapeHtml(name)} <small>(${answers.length})</small>${cheaterBadge}</h2>`

  if (answers.length === 0) {
    return html + `<p class="none">No answers.</p>`
  }

  const userHeaders = completionTabId
    ? "<th>User ID</th><th>Name</th><th>Email</th><th>Course points</th><th>Grade</th>"
    : "<th>Answer ID</th>"
  html += `<table><thead><tr>${userHeaders}<th>Answer</th>${gha ? "<th>GHA status</th>" : ""}<th>Checks</th><th>Action</th></tr></thead><tbody>`
  for (const item of answers) {
    html += renderAnswerRow(item, courseResult, completionTabId)
  }
  html += `</tbody></table>`

  return html
}

function renderResetModal() {
  const options = RESET_REASONS.map(
    (reason) =>
      `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`,
  ).join("\n        ")
  return `<div id="reset-modal-overlay" class="modal-overlay" hidden>
    <div class="modal">
      <h3>Reset exercise</h3>
      <label for="reset-reason-select">Reason</label>
      <select id="reset-reason-select">
        ${options}
        <option value="__other__">Other (write below)</option>
      </select>
      <textarea id="reset-reason-text" placeholder="Justification" hidden></textarea>
      <div class="modal-actions">
        <button type="button" id="reset-modal-cancel" class="grade-btn">Cancel</button>
        <button type="button" id="reset-modal-submit" class="grade-btn grade-btn-zero">Submit reset</button>
      </div>
    </div>
  </div>`
}

function renderLoadError({ name, error }) {
  return `<h2>${escapeHtml(name)}</h2><p class="load-error">Could not load: ${escapeHtml(error)}</p>`
}

function tabUrl(tabId, basePath) {
  return `${basePath}/${encodeURIComponent(tabId)}`
}

function renderOverviewRow(overview, basePath) {
  const flagged =
    overview.cheaterCount > 0
      ? `<span class="badge s-flagged">${overview.cheaterCount} flagged</span>`
      : ""
  const failed =
    overview.failed.length > 0
      ? `<p class="load-error">Could not load: ${overview.failed
          .map(({ name, error }) => `${escapeHtml(name)} (${escapeHtml(error)})`)
          .join(", ")}</p>`
      : ""
  return `<tr><td><a href="${escapeHtml(tabUrl(overview.id, basePath))}">${escapeHtml(overview.name)}</a>${failed}</td><td>${overview.answerCount}</td><td>${flagged}</td></tr>`
}

function renderOverviewPage(overviews, { basePath = "" } = {}) {
  return layout({
    title: "Answers requiring attention",
    basePath,
    body: `<h1>Answers requiring attention</h1>
<table><thead><tr><th>Tab</th><th>Answers</th><th>Suspected cheaters</th></tr></thead><tbody>${overviews.map((overview) => renderOverviewRow(overview, basePath)).join("")}</tbody></table>`,
  })
}

// Tabs with completions list answers per user and use the full page width
function renderTabPage(tab, results, { basePath = "" } = {}) {
  const completionTabId = tab.completion ? tab.id : null
  const sections = results.map((courseResult) =>
    courseResult.error
      ? renderLoadError(courseResult)
      : renderCourseSection(courseResult, completionTabId, basePath),
  )

  return layout({
    title: `${escapeHtml(tab.name)} - answers requiring attention`,
    basePath,
    bodyClass: completionTabId ? "compact" : null,
    body: `<p><a href="${escapeHtml(basePath)}/">&larr; Overview</a></p><h1>${escapeHtml(tab.name)}</h1>${sections.join("")}${renderResetModal()}
  <script src="${escapeHtml(basePath)}/static/grading.js"></script>`,
  })
}

function renderCheaterRow(cheater) {
  const submissionsCell = cheater.submissions
    .map((content) =>
      content.startsWith("http") ? externalLink(content) : escapeHtml(content),
    )
    .join("<br>")
  const userId = escapeHtml(cheater.userId)
  const actionCell = `<td><button class="grade-btn grade-btn-green cheater-action-btn" data-action="dismiss" data-user-id="${userId}">Honest</button><button class="grade-btn grade-btn-zero cheater-action-btn" data-action="confirm" data-user-id="${userId}">CHEATER</button><span class="grade-result"></span></td>`
  return `<tr><td>${userId}</td><td>${escapeHtml(cheater.name ?? "")}</td><td>${escapeHtml(cheater.email ?? "")}</td><td>${escapeHtml(cheater.durationMinutes)}</td><td>${escapeHtml(cheater.totalPoints)}</td><td>${submissionsCell}</td>${actionCell}</tr>`
}

function renderCheatersPage(courseName, cheaters, courseId, { basePath = "" } = {}) {
  const table =
    cheaters.length === 0
      ? `<p class="none">No flagged users.</p>`
      : `<table><thead><tr><th>User ID</th><th>Name</th><th>Email</th><th>Duration (min)</th><th>Points</th><th>GH exercise submissions</th><th>Action</th></tr></thead><tbody>${cheaters.map(renderCheaterRow).join("")}</tbody></table>`

  return layout({
    title: `Suspected cheaters - ${escapeHtml(courseName)}`,
    basePath,
    bodyClass: "compact",
    bodyAttributes: ` data-course-id="${escapeHtml(courseId)}"`,
    body: `<h1>Suspected cheaters <small>(${escapeHtml(courseName)})</small></h1>${table}
  <script src="${escapeHtml(basePath)}/static/cheaters.js"></script>`,
  })
}

module.exports = { renderOverviewPage, renderTabPage, renderCheatersPage }
