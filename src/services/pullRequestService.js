const { parsePullRequestUrl } = require("../domain/repository")

const APPROVAL_COMMENT = "good job"

// Pull requests are approved with the first GitHub account that succeeds:
// an account cannot approve its own pull request, and only the account a
// student invited can see a private repository.
// onApproved(repo) is called with the "owner/repo" of each approved pull
// request, e.g. to drop its cached reviews
function createPullRequestService({ accounts, onApproved = () => {} }) {
  // { ok: true, label } of the approving account, or { error }
  async function approve(prUrl) {
    const pullRequest = parsePullRequestUrl(prUrl)
    if (!pullRequest) {
      return { error: "Not a GitHub pull request link" }
    }

    const failures = []
    for (const { index, label } of accounts.listAccounts()) {
      try {
        await accounts.approvePullRequest(
          accounts.findAccount(index),
          pullRequest,
          APPROVAL_COMMENT,
        )
      } catch (error) {
        failures.push(`${label}: ${error.message}`)
        continue
      }
      onApproved(`${pullRequest.owner}/${pullRequest.repo}`)
      return { ok: true, label }
    }
    return {
      error: failures.length > 0 ? failures.join("; ") : "No GitHub accounts configured",
    }
  }

  return { approve }
}

module.exports = { createPullRequestService, APPROVAL_COMMENT }
