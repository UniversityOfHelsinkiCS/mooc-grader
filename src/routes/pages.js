const express = require("express")
const { escapeHtml } = require("../views/html")
const {
  renderOverviewPage,
  renderTabPage,
  renderCheatersPage,
} = require("../views/pages")
const { renderInvitesPage } = require("../views/invitesPage")
const { findTab, findCheatersCourse } = require("../config/tabs")

function errorPage(res, status, message) {
  return res.status(status).send(`<pre>${escapeHtml(message)}</pre>`)
}

function createPageRouter({ tabs, courseService, invitationService, basePath }) {
  const router = express.Router()

  router.get("/", async (req, res) => {
    try {
      const [overviews, invites] = await Promise.all([
        Promise.all(tabs.map(courseService.fetchTabOverview)),
        invitationService ? invitationService.fetchSummary() : null,
      ])
      res.send(renderOverviewPage(overviews, { basePath, invites }))
    } catch (err) {
      errorPage(res, 500, err.message)
    }
  })

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
