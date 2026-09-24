const express = require("express")
const { buildGradingDecision, buildCompletion } = require("../domain/grading")
const { isUuid } = require("../domain/validation")
const {
  findTab,
  findCourseByExercise,
  findCheatersCourse,
} = require("../config/tabs")

// Relays a mooc.fi response to the browser as { ok, status, body }
async function relay(res, requestUpstream) {
  try {
    const response = await requestUpstream()
    const ok = response.status >= 200 && response.status < 300
    return res.status(ok ? 200 : response.status || 500).json({
      ok,
      status: response.status,
      body: response.body,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

function createApiRouter({ tabs, mooc }) {
  const router = express.Router()

  router.post("/grade", (req, res) => {
    const input = req.body || {}
    if (!input.user_exercise_state_id || !input.exercise_id) {
      return res
        .status(400)
        .json({ error: "Missing user_exercise_state_id or exercise_id" })
    }
    if (!findCourseByExercise(tabs, input.exercise_id)) {
      return res.status(400).json({ error: "Unknown exercise_id" })
    }

    const { error, payload } = buildGradingDecision(input)
    if (error) {
      return res.status(400).json({ error })
    }

    return relay(res, () => mooc.postGradingDecision(payload))
  })

  // The completion goes to the course instance of the tab it was made in
  router.post("/completion", (req, res) => {
    const input = req.body || {}
    if (!input.user_id) {
      return res.status(400).json({ error: "Missing user_id" })
    }
    const completion = findTab(tabs, input.tab_id)?.completion
    if (!completion) {
      return res.status(400).json({ error: "Unknown tab_id or tab has no completions" })
    }

    const { error, payload } = buildCompletion(input, completion.courseModuleId)
    if (error) {
      return res.status(400).json({ error })
    }

    return relay(res, () =>
      mooc.postCompletions(completion.courseInstanceId, payload),
    )
  })

  function cheaterAction(action) {
    return (req, res) => {
      const { courseId, userId } = req.body || {}
      if (!courseId || !userId) {
        return res.status(400).json({ error: "Missing courseId or userId" })
      }
      // userId goes into a mooc.fi URL path
      if (!isUuid(userId)) {
        return res.status(400).json({ error: "Invalid userId" })
      }
      if (!findCheatersCourse(tabs, courseId)) {
        return res.status(400).json({ error: "Unknown courseId" })
      }

      return relay(res, () => mooc.postCheaterAction(courseId, action, userId))
    }
  }

  router.post("/dismiss-cheater", cheaterAction("dismiss"))
  router.post("/confirm-cheater", cheaterAction("confirm"))

  return router
}

module.exports = { createApiRouter }
