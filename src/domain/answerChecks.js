// Checks of an answer and the verdicts drawn from them, shared by the tab
// page and the scheduled grading (src/services/autoGrader.js)
const { isGhaFailed, isGhaPassing, ghaOutcome } = require("./repository")

const RESET_REASONS = [
  "repository must be accessible by user mluukkai",
  "tests must pass in GitHub",
  "QR-code missing",
  "README.md does not contain the required links",
  "the answer must be a link to a pull request",
]

// PR: approved is OK, no pull request link is missing, and a pull request
// waiting for approval (or whose reviews could not be read) is unknown
function answerChecks(item, { qr, gha, linkCount, pr }) {
  const checks = []
  if (pr) {
    const ok = !item._prUrl ? false : item._prApprovedBy?.length > 0 ? true : null
    checks.push({ label: "PR", ok })
  }
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

// Correct: every check of the answer passed, the same as a PASS badge
function isCorrect(item, courseResult) {
  const checks = answerChecks(item, courseResult)
  return checks.length > 0 && checks.every((check) => check.ok === true)
}

// Incorrect: a check of the answer failed, the same as a FAIL badge. An
// answer whose GitHub Actions run is still going is not judged yet.
function isIncorrect(item, courseResult) {
  if (courseResult.gha && ghaOutcome(item._ghaStatus?.conclusion) === "pending") {
    return false
  }
  return answerChecks(item, courseResult).some((check) => check.ok === false)
}

// The reset reason of the first failed check of the answer, or null when
// none applies; the same order as resetReasonFor in public/bulkGrading.js
function resetReason(item, courseResult) {
  if (item._repoUrl && item._repoExists === false) return RESET_REASONS[0]
  if (courseResult.gha && isGhaFailed(item._ghaStatus?.conclusion)) return RESET_REASONS[1]
  if (item._qrExists === false) return RESET_REASONS[2]
  if (item._linksOk === false) return RESET_REASONS[3]
  if (courseResult.pr && !item._prUrl) return RESET_REASONS[4]
  return null
}

module.exports = { RESET_REASONS, answerChecks, isCorrect, isIncorrect, resetReason }
