const express = require("express")
const { escapeHtml } = require("../views/html")
const {
  renderOverviewPage,
  renderTabPage,
  renderCheatersPage,
} = require("../views/pages")
const { findTab, findCheatersCourse } = require("../config/tabs")

function errorPage(res, status, message) {
  return res.status(status).send(`<pre>${escapeHtml(message)}</pre>`)
}

function createPageRouter({ tabs, courseService }) {
  const router = express.Router()

  router.get("/", async (req, res) => {
    try {
      const overviews = await Promise.all(tabs.map(courseService.fetchTabOverview))
      res.send(renderOverviewPage(overviews))
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
      res.send(renderCheatersPage(name, cheaters, courseId))
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
      res.send(renderTabPage(tab, results))
    } catch (err) {
      errorPage(res, 500, err.message)
    }
  })

  return router
}

module.exports = { createPageRouter }
