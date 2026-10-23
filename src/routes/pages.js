const express = require("express")
const { escapeHtml } = require("../views/html")
const {
  SUOTAR_LINKS,
  renderOverviewPage,
  renderOverviewRow,
  renderSuotarRow,
  renderTabPage,
  renderCheatersPage,
} = require("../views/pages")
const {
  renderInvitesPage,
  renderInvitesSummaryRow,
} = require("../views/invitesPage")
const { renderLogPage, parseLogQuery } = require("../views/logPage")
const { findTab, findCheatersCourse } = require("../config/tabs")
const { noActionLog } = require("../infra/actionLog")

const LOG_PAGE_SIZE = 200

function errorPage(res, status, message) {
  return res.status(status).send(`<pre>${escapeHtml(message)}</pre>`)
}

// The rows of the overview page, loaded by its script one by one. A failure
// is answered with the message as text, which the script shows in the row.
function sendRow(res, loadRow) {
  loadRow()
    .then((row) => (row ? res.send(row) : res.status(404).type("text").send("Not found")))
    .catch((err) => res.status(500).type("text").send(err.message))
}

function createPageRouter({
  tabs,
  courseService,
  invitationService,
  stats,
  actionLog = noActionLog,
  basePath,
}) {
  const router = express.Router()

  router.get("/", (req, res) => {
    res.send(
      renderOverviewPage(tabs, {
        basePath,
        invitationAccounts: invitationService ? invitationService.listAccounts() : null,
      }),
    )
  })

  router.get("/overview/tabs/:tabId", (req, res) =>
    sendRow(res, async () => {
      const tab = findTab(tabs, req.params.tabId)
      return tab && renderOverviewRow(await courseService.fetchTabOverview(tab), basePath)
    }),
  )

  router.get("/overview/invites/:account", (req, res) =>
    sendRow(res, async () => {
      const account =
        invitationService && /^\d+$/.test(req.params.account)
          ? await invitationService.fetchAccountSummary(Number(req.params.account))
          : null
      return account && renderInvitesSummaryRow(account)
    }),
  )

  // A count that cannot be loaded is shown as such, not as a failed row
  router.get("/overview/suotar/:index", (req, res) =>
    sendRow(res, async () => {
      const link = /^\d+$/.test(req.params.index) ? SUOTAR_LINKS[Number(req.params.index)] : null
      if (!link) return null
      const count = stats
        ? await stats.fetchCompletionCount(link.countUrl).catch((err) => {
            console.error(err.message)
            return null
          })
        : null
      return renderSuotarRow(link, count)
    }),
  )

  router.get("/invites", async (req, res) => {
    if (!invitationService) {
      return errorPage(res, 404, "Not found")
    }
    try {
      const accounts = await invitationService.fetchInvitations()
      res.send(
        renderInvitesPage(accounts, invitationService.recentlyAccepted(), { basePath }),
      )
    } catch (err) {
      errorPage(res, 500, err.message)
    }
  })

  router.get("/log", async (req, res) => {
    const { before, filters } = parseLogQuery(req.query)
    try {
      const rows =
        filters.view === "actions"
          ? await actionLog.recent({ limit: LOG_PAGE_SIZE, before, filters })
          : await actionLog.summary({ filters })
      // The report lists the failed actions of the range below the counts
      const failures =
        filters.view === "report"
          ? await actionLog.recent({ limit: LOG_PAGE_SIZE, filters: { ...filters, failed: true } })
          : []
      res.send(
        renderLogPage(rows, {
          tabs,
          filters,
          failures,
          limit: LOG_PAGE_SIZE,
          enabled: actionLog.enabled,
          basePath,
        }),
      )
    } catch (err) {
      errorPage(res, 500, err.message)
    }
  })

  router.get("/cheaters/:courseId", async (req, res) => {
    try {
      const { courseId } = req.params
      const course = findCheatersCourse(tabs, courseId)
      if (!course) {
        return errorPage(res, 404, "Course not found")
      }

      const { name, cheaters } = await courseService.fetchCheatersData(course)
      res.send(renderCheatersPage(name, cheaters, courseId, { basePath }))
    } catch (err) {
      errorPage(res, 500, err.message)
    }
  })

  // Registered last: /:tabId matches any single-segment path
  router.get("/:tabId", async (req, res) => {
    try {
      const tab = findTab(tabs, req.params.tabId)
      if (!tab) {
        return errorPage(res, 404, "Tab not found")
      }

      const results = await courseService.fetchTabData(tab)
      res.send(renderTabPage(tab, results, { basePath }))
    } catch (err) {
      errorPage(res, 500, err.message)
    }
  })

  return router
}

module.exports = { createPageRouter }
