const { getItemTexts } = require("../domain/answers")
const { calculateGrade, RESUBMIT_INSTRUCTIONS } = require("../domain/grading")
const { isGhaFailed } = require("../domain/repository")
const {
  RESET_REASONS,
  answerChecks,
  isCorrect,
  isIncorrect,
} = require("../domain/answerChecks")
const { escapeHtml, externalLink, layout, loadingRow } = require("./html")
const { renderInvitesSummary } = require("./invitesPage")
const {
  renderAnswerCell,
  renderGhaCell,
  renderChecksCell,
  renderActionCell,
} = require("./cells")

function optionalCell(show, value) {
  if (!show) return ""
  return value !== null && value !== undefined
    ? `<td>${escapeHtml(value)}</td>`
    : "<td></td>"
}

// approvedBy: logins that have approved the pull request; undefined or null
// when there is no pull request or its reviews could not be read
function renderPrApproval(approvedBy) {
  if (!approvedBy) return ""
  return approvedBy.length > 0
    ? ` <span class="pr-approved">approved by ${escapeHtml(approvedBy.join(", "))}</span>`
    : ` <span class="pr-not-approved">not approved</span>`
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
    correct: isCorrect(item, courseResult),
    incorrect: isIncorrect(item, courseResult),
    prUrl: item._prUrl,
    prMissing: courseResult.pr && !item._prUrl,
    prApproved: item._prApprovedBy?.length > 0,
  })

  const approval = renderPrApproval(item._prApprovedBy)
  const userCells = completionTabId
    ? [
        optionalCell(true, item.user_id),
        optionalCell(true, item._userName),
        optionalCell(true, item._userEmail),
        optionalCell(true, item._coursePoints),
        optionalCell(true, grade),
      ].join("")
    : `<td>${escapeHtml(item.id)}</td><td class="user-id">${escapeHtml(item.user_id ?? "")}</td>`

  return `<tr>${userCells}<td>${answerCell}${approval}</td>${renderGhaCell(gha, item._ghaStatus)}${renderChecksCell(answerChecks(item, courseResult))}${actionCell}</tr>`
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
    : `<th>Answer ID</th><th class="user-id">User ID</th>`
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
      <p class="reset-instructions">Added to the message: ${escapeHtml(RESUBMIT_INSTRUCTIONS)}</p>
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

// countUrl: stats API answering { count } of completions waiting for Suotar
const SUOTAR_LINKS = [
  {
    name: "Full stack",
    url: "https://studies.cs.helsinki.fi/stats/courses/fullstackopen/admin/suotar",
    countUrl: "https://studies.cs.helsinki.fi/stats/api/external/courses/ofs2019/new-completed",
  },
  {
    name: "Akateemiset taidot",
    url: "https://study.cs.helsinki.fi/stats/courses/akateemiset-taidot/admin/suotar",
    countUrl: "https://study.cs.helsinki.fi/stats/external-api/courses/akateemiset-taidot",
  },
]

function suotarLink({ name, url }) {
  return externalLink(url, escapeHtml(name))
}

// count: null when it could not be loaded
function renderSuotarRow(link, count) {
  return Number.isInteger(count)
    ? `<tr><td>${suotarLink(link)}</td><td>${count}</td></tr>`
    : `<tr><td>${suotarLink(link)}</td><td class="load-error">Could not load</td></tr>`
}

function renderSuotarTable(basePath) {
  const rows = SUOTAR_LINKS.map((link, index) =>
    loadingRow(`${basePath}/overview/suotar/${index}`, suotarLink(link), 1),
  ).join("")
  return `<h1>Suotar</h1>
<table class="summary"><thead><tr><th>Course</th><th>Completions</th></tr></thead><tbody>${rows}</tbody></table>`
}

// The page is sent at once with placeholder rows that the page script
// fills in one by one. invitationAccounts: invitationService.listAccounts(),
// or null to leave the section out
function renderOverviewPage(tabs, { basePath = "", invitationAccounts = null } = {}) {
  // Tabs with completions are graded by hand, user by user, so they get a
  // table of their own and are not graded from the overview
  const gradedTabs = tabs.filter((tab) => !tab.completion)
  const manualTabs = tabs.filter((tab) => tab.completion)
  const gradeAllTabs =
    gradedTabs.length > 0
      ? ` <button type="button" id="grade-all-tabs" class="grade-btn grade-btn-all" data-tabs="${escapeHtml(gradedTabs.map((tab) => tab.id).join(","))}">Full points to correct, reset incorrect: ${escapeHtml(gradedTabs.map((tab) => tab.name).join(", "))}</button><span id="grade-all-tabs-result" class="grade-result"></span>`
      : ""
  const manual =
    manualTabs.length > 0
      ? `<h1>Manual grading</h1>
${renderTabTable(manualTabs, basePath)}
`
      : ""
  const invites = invitationAccounts
    ? `${renderInvitesSummary(invitationAccounts, basePath)}\n`
    : ""
  return layout({
    title: "Answers requiring attention",
    basePath,
    body: `<nav class="top-nav"><a href="${escapeHtml(basePath)}/log">Action log</a></nav>
${invites}<h1>Answers requiring attention${gradeAllTabs}</h1>
${renderTabTable(gradedTabs, basePath, "tab-summary")}
${manual}${renderSuotarTable(basePath)}
  <script src="${escapeHtml(basePath)}/static/bulkGrading.js"></script>
  <script src="${escapeHtml(basePath)}/static/overview.js"></script>`,
  })
}

// Placeholder rows of the tabs that the overview page script fills in
function renderTabTable(tabs, basePath, id = null) {
  const rows = tabs
    .map((tab) =>
      loadingRow(
        `${basePath}/overview/tabs/${encodeURIComponent(tab.id)}`,
        `<a href="${escapeHtml(tabUrl(tab.id, basePath))}">${escapeHtml(tab.name)}</a>`,
        2,
      ),
    )
    .join("")
  const idAttribute = id ? ` id="${id}"` : ""
  return `<table class="summary"${idAttribute}><thead><tr><th>Tab</th><th>Answers</th><th>Cheaters</th></tr></thead><tbody>${rows}</tbody></table>`
}

// A course needs attention when it has answers, flagged cheaters or could
// not be loaded; the others are hidden unless "Show all courses" is checked
function needsAttention(courseResult) {
  return (
    !!courseResult.error ||
    courseResult.answers.length > 0 ||
    courseResult.cheaterCount > 0
  )
}

// Gives full points to every correct answer of the tab and resets every
// incorrect one with the reason of its failed check. Tabs with completions
// submit them one by one instead.
function renderBulkGrading(results, completionTabId) {
  if (completionTabId) return ""
  const answers = results
    .filter((result) => !result.error)
    .flatMap((result) => result.answers.map((item) => [item, result]))
  const correct = answers.filter(([item, result]) => isCorrect(item, result)).length
  const incorrect = answers.filter(([item, result]) => isIncorrect(item, result)).length
  const acceptButton =
    correct > 0
      ? `<button type="button" id="accept-correct" class="grade-btn grade-btn-green" data-count="${correct}">Full points to all correct (${correct})</button><span id="accept-correct-result" class="grade-result"></span> `
      : ""
  const rejectButton =
    incorrect > 0
      ? `<button type="button" id="reject-incorrect" class="grade-btn grade-btn-reset" data-count="${incorrect}">Reset all incorrect (${incorrect})</button><span id="reject-incorrect-result" class="grade-result"></span>`
      : ""
  // Both at once; with only one kind of answer the buttons above suffice
  const bothButton =
    correct > 0 && incorrect > 0
      ? `<button type="button" id="grade-all" class="grade-btn grade-btn-all" data-count="${correct + incorrect}">Full points to correct, reset incorrect (${correct} + ${incorrect})</button><span id="grade-all-result" class="grade-result"></span> `
      : ""
  return acceptButton || rejectButton
    ? `<p>${bothButton}${acceptButton}${rejectButton}</p>`
    : ""
}

// Marks every flagged user of the tab's courses honest; courses sharing a
// mooc.fi course are counted once
function renderAllHonest(results, tabId) {
  const counts = new Map(
    results
      .filter((result) => !result.error && result.cheaterCount > 0)
      .map((result) => [result.courseId, result.cheaterCount]),
  )
  const count = [...counts.values()].reduce((sum, n) => sum + n, 0)
  if (count === 0) return ""
  return `<p><button type="button" id="all-honest" class="grade-btn grade-btn-green" data-tab-id="${escapeHtml(tabId)}" data-count="${count}">All flagged honest (${count})</button><span id="all-honest-result" class="grade-result"></span></p>`
}

// The toggle is a plain checkbox that CSS reacts to, so it needs no script
function renderCourseFilter(quietCount, total) {
  if (quietCount === 0) return ""
  const allQuiet =
    quietCount === total
      ? `<p class="none all-quiet">Nothing requires attention.</p>`
      : ""
  return `<label class="show-all"><input type="checkbox" id="show-all-courses"> Show all courses (${quietCount} without anything to do)</label>${allQuiet}`
}

// Like the course filter a plain checkbox; tabs with completions always
// show the user id
function renderUserIdToggle(completionTabId) {
  if (completionTabId) return ""
  return `<label class="show-all"><input type="checkbox" id="show-user-ids"> Show user IDs</label> `
}

// Tabs with completions list answers per user and use the full page width
function renderTabPage(tab, results, { basePath = "" } = {}) {
  const completionTabId = tab.completion ? tab.id : null
  const sections = results.map((courseResult) => {
    const html = courseResult.error
      ? renderLoadError(courseResult)
      : renderCourseSection(courseResult, completionTabId, basePath)
    return needsAttention(courseResult)
      ? `<section class="course">${html}</section>`
      : `<section class="course quiet">${html}</section>`
  })
  const quietCount = results.filter((result) => !needsAttention(result)).length

  return layout({
    title: `${escapeHtml(tab.name)} - answers requiring attention`,
    basePath,
    bodyClass: completionTabId ? "compact" : null,
    body: `<p><a href="${escapeHtml(basePath)}/">&larr; Overview</a></p><h1>${escapeHtml(tab.name)}</h1>${renderBulkGrading(results, completionTabId)}${renderAllHonest(results, tab.id)}${renderUserIdToggle(completionTabId)}${renderCourseFilter(quietCount, results.length)}${sections.join("")}${renderResetModal()}
  <script src="${escapeHtml(basePath)}/static/bulkGrading.js"></script>
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

module.exports = {
  SUOTAR_LINKS,
  renderOverviewPage,
  renderOverviewRow,
  renderSuotarRow,
  renderTabPage,
  renderCheatersPage,
}
