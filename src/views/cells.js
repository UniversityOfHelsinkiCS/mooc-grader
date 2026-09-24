const { CHECKED_PREFIX, UNCHECKED_PREFIX } = require("../domain/answers")
const { ghaOutcome } = require("../domain/repository")
const { escapeHtml, externalLink } = require("./html")

function repoBadges(
  isRepoLink,
  { repoExists, qrExists, linksOk, minLinks },
) {
  if (!isRepoLink) {
    return ""
  }

  const missingBadge =
    repoExists === false
      ? ` <span class="repo-missing" title="Repository not found">no access</span>`
      : ""
  const qrBadge =
    qrExists === true
      ? ` <span class="qr-ok" title="QR code found in README">QR</span>`
      : qrExists === false
        ? ` <span class="qr-missing" title="No QR code found in README">QR</span>`
        : ""
  const linksRequirement =
    minLinks <= 1
      ? "a GitHub repo link"
      : `${minLinks}+ different links, including a GitHub repo link`
  const linksBadge =
    linksOk === true
      ? ` <span class="links-ok" title="README contains ${linksRequirement}">LINKS</span>`
      : linksOk === false
        ? ` <span class="links-missing" title="README needs ${linksRequirement}">LINKS</span>`
        : ""
  return `${missingBadge}${qrBadge}${linksBadge}`
}

function renderAnswerCell(
  texts,
  {
    repoUrl = null,
    repoExists = null,
    qrExists = null,
    linksOk = null,
    minLinks = 2,
  } = {},
) {
  const checkedItems = texts.filter((text) => text.startsWith(CHECKED_PREFIX))
  const uncheckedItems = texts.filter((text) =>
    text.startsWith(UNCHECKED_PREFIX),
  )
  const plainTexts = texts.filter(
    (text) =>
      !text.startsWith(CHECKED_PREFIX) && !text.startsWith(UNCHECKED_PREFIX),
  )

  const checkedMark = `<span class="checkbox-ok" title="${escapeHtml(checkedItems.map((text) => text.replace(CHECKED_PREFIX, "")).join(", "))}">✓</span>`

  const renderedTexts = plainTexts.map((text, index) => {
    const suffix =
      index === plainTexts.length - 1 && checkedItems.length > 0
        ? ` ${checkedMark}`
        : ""

    if (text.startsWith("http")) {
      const badges = repoBadges(text === repoUrl, {
        repoExists,
        qrExists,
        linksOk,
        minLinks,
      })
      return `${externalLink(text)}${suffix}${badges}`
    }

    return `${escapeHtml(text)}${suffix}`
  })

  if (renderedTexts.length === 0 && checkedItems.length > 0) {
    renderedTexts.push(checkedMark)
  }

  renderedTexts.push(
    ...uncheckedItems.map((text) => {
      const label = escapeHtml(text.replace(UNCHECKED_PREFIX, ""))
      return `<span class="checkbox-no" title="${label}">○</span>`
    }),
  )

  return renderedTexts.join("<br>")
}

function renderGhaCell(ghaEnabled, status) {
  if (!ghaEnabled) {
    return ""
  }

  const label = status?.conclusion ?? "n/a"
  const branchText = status?.branch ? ` (${escapeHtml(status.branch)})` : ""
  return `<td><span class="badge gha-${ghaOutcome(label)}">${escapeHtml(label)}${branchText}</span></td>`
}

// checks: [{ label, ok: true | false | null }]
function renderChecksCell(checks) {
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

function gradeButton(action, cssClass, label, attributes) {
  const dataAttributes = Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([name, value]) => ` data-${name}="${escapeHtml(value)}"`)
    .join("")
  const classes = cssClass ? `grade-btn ${cssClass}` : "grade-btn"
  return `<button class="${classes}" data-action="${action}"${dataAttributes}>${label}</button>`
}

// data-user-id carries the answer's user_exercise_state_id, except for the
// Completion button where it is the user id and data-item-id is the answer.
// completionTabId: the tab completions are submitted from; it replaces
// Full points with Completion
function renderActionCell({
  itemId,
  exerciseId,
  userId = null,
  grade = null,
  completionTabId = null,
  qrMissing = false,
  linksMissing = false,
  repoMissing = false,
  ghaFailed = false,
}) {
  const target = { "user-id": itemId, "exercise-id": exerciseId }

  const fullPointsBtn = completionTabId
    ? ""
    : gradeButton("FullPoints", null, "Full points", target)
  const completionBtn =
    completionTabId && userId
      ? gradeButton("Completion", null, "Completion", {
          "user-id": userId,
          "item-id": itemId,
          "exercise-id": exerciseId,
          "tab-id": completionTabId,
          grade: grade ?? "",
        })
      : ""
  const resetBtn = gradeButton("Reset", "grade-btn-reset", "Reset", {
    ...target,
    "repo-missing": repoMissing && "true",
    "gha-failed": ghaFailed && "true",
    "qr-missing": qrMissing && "true",
    "links-missing": linksMissing && "true",
  })
  const zeroPointsBtn = gradeButton(
    "ZeroPoints",
    "grade-btn-zero",
    "Zero points",
    target,
  )

  const buttons = completionTabId
    ? `${completionBtn}${zeroPointsBtn}${resetBtn}${fullPointsBtn}`
    : `${fullPointsBtn}${resetBtn}${zeroPointsBtn}`

  return `<td><span class="grade-actions">${buttons}</span><span class="grade-result"></span></td>`
}

module.exports = {
  renderAnswerCell,
  renderGhaCell,
  renderChecksCell,
  renderActionCell,
}
