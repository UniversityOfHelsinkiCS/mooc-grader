// Only plain GitHub names are accepted so that a crafted answer cannot
// point the API calls elsewhere (e.g. with ".." path segments)
const REPO_URL_PATTERN =
  /github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+)(?:\/tree\/[^/\s]+\/([A-Za-z0-9._\/-]+))?/

function isPlainSegment(segment) {
  return segment !== "" && segment !== "." && segment !== ".."
}

function parseGitHubRepo(url) {
  const match = url.match(REPO_URL_PATTERN)
  if (!match) return null

  const repo = match[2].replace(/\.git$/, "")
  const dirSegments = match[3] ? match[3].split("/").filter(Boolean) : []
  if (!isPlainSegment(repo) || !dirSegments.every(isPlainSegment)) {
    return null
  }

  return {
    owner: match[1],
    repo,
    dir: dirSegments.length > 0 ? dirSegments.join("/") : null,
  }
}

// Quantifiers are bounded so that matching stays linear on crafted READMEs
const QR_HINT_PATTERN =
  /qr[-_ ]?code|qrcode|c[oó]digo[-_ ]?qr|escane[oa]?.{0,20}\bqr\b|\bqr\b.{0,20}(escane|c[oó]digo)|api\.qrserver\.com|chart\.googleapis\.com\/chart\?cht=qr|quickchart\.io\/qr|qr\.expo\.dev|goqr\.me|qrcode-monkey|qrcode\.show|[(!\[][^)\]]{0,300}qr[-_.]?(code)?\.(png|jpe?g|gif|svg|webp)/i

function readmeHasQrCode(text) {
  return QR_HINT_PATTERN.test(text)
}

// Collects http(s) URLs from markdown links and plain text
function extractReadmeUrls(text) {
  const urls = new Set()

  const mdLinkRegex = /\[([^\]]{1,500})\]\(([^)]{1,2000})\)/g
  let match
  while ((match = mdLinkRegex.exec(text)) !== null) {
    const url = match[2].trim()
    if (url.startsWith("http://") || url.startsWith("https://")) {
      urls.add(url)
    }
  }

  // Markdown link targets are removed first so that "(url)" is not
  // matched again as a plain URL with a trailing parenthesis
  const plainUrlRegex = /https?:\/\/[^\s<>"'`]+/g
  const withoutMdTargets = text.replace(mdLinkRegex, "[$1]")
  const plainMatches = withoutMdTargets.match(plainUrlRegex) || []
  plainMatches.forEach((url) => urls.add(url))

  return Array.from(urls)
}

function readmeLinksOk(readmeUrls, linkCount) {
  return (
    readmeUrls.length >= linkCount &&
    readmeUrls.some((url) => url.includes("github.com"))
  )
}

// Picks the latest run that is not a scheduled or health-check workflow
function selectRelevantRun(workflowRuns) {
  return (
    workflowRuns.find((run) => {
      if (run.event === "schedule") return false
      const workflowName = run.path || run.name || ""
      if (
        workflowName.includes("health-check") ||
        workflowName.includes("periodic")
      )
        return false
      return true
    }) ?? null
  )
}

// Lookups that did not reach the student's workflow runs; a missing repo is
// reported by the Repo check instead
const GHA_LOOKUP_FAILURES = ["rate limited", "error", "not found"]

function isGhaFailed(conclusion) {
  return (
    !!conclusion &&
    conclusion !== "success" &&
    !GHA_LOOKUP_FAILURES.includes(conclusion)
  )
}

// true / false, or null when the status could not be looked up
function isGhaPassing(conclusion) {
  if (!conclusion || GHA_LOOKUP_FAILURES.includes(conclusion)) {
    return null
  }
  return conclusion === "success"
}

const GHA_FAILURES = ["failure", "timed_out", "startup_failure"]
const GHA_PENDING = [
  "in_progress",
  "queued",
  "requested",
  "waiting",
  "pending",
  "action_required",
]

// Groups GitHub's run conclusions and statuses (plus our own "no runs",
// "error", "rate limited") into the four badge styles
function ghaOutcome(conclusion) {
  if (conclusion === "success") return "success"
  if (GHA_FAILURES.includes(conclusion)) return "failure"
  if (GHA_PENDING.includes(conclusion)) return "pending"
  return "neutral"
}

module.exports = {
  parseGitHubRepo,
  QR_HINT_PATTERN,
  readmeHasQrCode,
  extractReadmeUrls,
  readmeLinksOk,
  selectRelevantRun,
  isGhaFailed,
  isGhaPassing,
  ghaOutcome,
}
