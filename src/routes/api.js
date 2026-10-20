const express = require("express")
const { buildGradingDecision, buildCompletion } = require("../domain/grading")
const { isUuid } = require("../domain/validation")
const { noActionLog } = require("../infra/actionLog")
const {
  findTab,
  findCourseByExercise,
  findTabByExercise,
  findCheatersCourse,
} = require("../config/tabs")

// Relays a mooc.fi response to the browser as { ok, status, body }, and
// reports the outcome to onDone({ ok, error })
async function relay(res, requestUpstream, onDone = () => {}) {
  try {
    const response = await requestUpstream()
    const ok = response.status >= 200 && response.status < 300
    onDone({ ok, error: ok ? null : upstreamError(response) })
    return res.status(ok ? 200 : response.status || 500).json({
      ok,
      status: response.status,
      body: response.body,
    })
  } catch (err) {
    onDone({ ok: false, error: err.message })
    return res.status(500).json({ error: err.message })
  }
}

function upstreamError(response) {
  const message = response.body?.error ?? response.body?.message
  return typeof message === "string" ? `${response.status}: ${message}` : `${response.status}`
}

const GRADE_LOG_ACTIONS = { FullPoints: "full_points", ZeroPoints: "zero_points", Other: "reset" }

// GitHub invitation ids are positive integers, accounts are indexes
function isIndex(value) {
  return Number.isInteger(value) && value >= 0
}

function createApiRouter({
  tabs,
  mooc,
  invitationService,
  pullRequestService,
  actionLog = noActionLog,
}) {
  const router = express.Router()

  // The acting admin is the Shibboleth uid; it is unknown in development
  const record = (req, entry) => actionLog.log({ actor_uid: req.uid ?? null, ...entry })

  // Course columns of an action on an exercise. The student's user id is
  // only for the log, so an invalid one is dropped rather than rejected
  function exerciseTarget(exerciseId, userId) {
    return {
      tab_id: findTabByExercise(tabs, exerciseId)?.id,
      course_id: findCourseByExercise(tabs, exerciseId)?.courseId,
      exercise_id: exerciseId,
      target_user_id: isUuid(userId) ? userId : null,
    }
  }

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

    return relay(
      res,
      () => mooc.postGradingDecision(payload),
      (outcome) =>
        record(req, {
          action: GRADE_LOG_ACTIONS[input.action],
          ...exerciseTarget(input.exercise_id, input.user_id),
          target_answer_id: input.user_exercise_state_id,
          details: input.action === "Other" ? { justification: input.justification } : null,
          ...outcome,
        }),
    )
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

    return relay(
      res,
      () => mooc.postCompletions(completion.courseInstanceId, payload),
      (outcome) =>
        record(req, {
          action: "completion",
          tab_id: input.tab_id,
          course_id: completion.courseInstanceId,
          target_user_id: input.user_id,
          details: { grade: input.grade, completion_date: input.completion_date },
          ...outcome,
        }),
    )
  })

  // Only pull requests of pr courses are approved; the link itself is
  // checked by the service
  router.post("/approve-pr", async (req, res) => {
    if (!pullRequestService) {
      return res.status(404).json({ error: "Not found" })
    }
    const { exercise_id: exerciseId, pr_url: prUrl, user_id: userId } = req.body || {}
    if (!findCourseByExercise(tabs, exerciseId)?.pr) {
      return res.status(400).json({ error: "Unknown exercise_id or not a pull request exercise" })
    }
    const log = (outcome, account = null) =>
      record(req, {
        action: "approve_pr",
        ...exerciseTarget(exerciseId, userId),
        details: { pr_url: prUrl, ...(account ? { account } : {}) },
        ...outcome,
      })
    try {
      const result = await pullRequestService.approve(prUrl)
      if (result.error) {
        log({ ok: false, error: result.error })
        return res.status(400).json({ error: result.error })
      }
      log({ ok: true }, result.label)
      return res.json({ ok: true, account: result.label })
    } catch (err) {
      log({ ok: false, error: err.message })
      return res.status(502).json({ error: err.message })
    }
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

      return relay(
        res,
        () => mooc.postCheaterAction(courseId, action, userId),
        (outcome) =>
          record(req, {
            action: `cheater_${action}`,
            course_id: courseId,
            target_user_id: userId,
            ...outcome,
          }),
      )
    }
  }

  router.post("/dismiss-cheater", cheaterAction("dismiss"))
  router.post("/confirm-cheater", cheaterAction("confirm"))

  // Marks every flagged user of the tab's cheaters courses honest, one at a
  // time so that mooc.fi is not flooded; a partial failure is reported with
  // how many succeeded
  router.post("/dismiss-all-cheaters", async (req, res) => {
    const tab = findTab(tabs, (req.body || {}).tab_id)
    if (!tab) {
      return res.status(400).json({ error: "Unknown tab_id" })
    }
    const courseIds = [
      ...new Set(tab.courses.filter((course) => course.cheaters).map((course) => course.courseId)),
    ]
    let done = 0
    const failed = []
    try {
      for (const courseId of courseIds) {
        const flagged = await mooc.getFlaggedCheaters(courseId)
        for (const userId of flagged.keys()) {
          const response = await mooc
            .postCheaterAction(courseId, "dismiss", userId)
            .catch((err) => ({ status: err.message }))
          const ok = response.status >= 200 && response.status < 300
          record(req, {
            action: "cheater_dismiss",
            tab_id: tab.id,
            course_id: courseId,
            target_user_id: userId,
            details: { bulk: true },
            ok,
            error: ok ? null : `${response.status}`,
          })
          if (ok) {
            done++
          } else {
            failed.push(`${userId} (${response.status})`)
          }
        }
      }
    } catch (err) {
      return res.status(502).json({ error: err.message, done })
    }
    return res.status(failed.length === 0 ? 200 : 502).json({
      ok: failed.length === 0,
      done,
      ...(failed.length === 0
        ? {}
        : { error: `${done} marked honest, ${failed.length} failed: ${failed.join("; ")}` }),
    })
  })

  // The log names an account by its label (e.g. "primary"), not its index
  function accountLabel(index) {
    return invitationService.listAccounts().find((account) => account.index === index)?.label ?? index
  }

  function invitationAction(action) {
    return async (req, res) => {
      if (!invitationService) {
        return res.status(404).json({ error: "Not found" })
      }
      const { account, invitationId } = req.body || {}
      if (!isIndex(account) || !isIndex(invitationId) || invitationId === 0) {
        return res.status(400).json({ error: "Invalid account or invitationId" })
      }
      const log = (outcome) =>
        record(req, {
          action: `invite_${action}`,
          details: { account: accountLabel(account), invitationId },
          ...outcome,
        })
      try {
        const result = await invitationService[action](account, invitationId)
        if (result.error) {
          log({ ok: false, error: result.error })
          return res.status(400).json({ error: result.error })
        }
        log({ ok: true })
        return res.json({ ok: true })
      } catch (err) {
        log({ ok: false, error: err.message })
        return res.status(502).json({ error: err.message })
      }
    }
  }

  router.post("/invitations/accept", invitationAction("accept"))
  router.post("/invitations/decline", invitationAction("decline"))

  // Actions on all matching invitations of an account; a partial failure
  // is reported with how many succeeded
  function bulkInvitationAction(action, pastTense, logAction) {
    return async (req, res) => {
      if (!invitationService) {
        return res.status(404).json({ error: "Not found" })
      }
      const { account } = req.body || {}
      if (!isIndex(account)) {
        return res.status(400).json({ error: "Invalid account" })
      }
      // One row per account: the service reports only a count of the done ones
      const log = (outcome, details = {}) =>
        record(req, {
          action: logAction,
          details: { account: accountLabel(account), ...details },
          ...outcome,
        })
      try {
        const result = await invitationService[action](account)
        if (result.error) {
          log({ ok: false, error: result.error })
          return res.status(400).json({ error: result.error })
        }
        // An account with nothing to accept or remove is not logged
        if (result.done > 0 || result.failed.length > 0) {
          log(
            { ok: result.ok, error: result.ok ? null : `${result.failed.length} failed` },
            {
              done: result.done,
              ...(result.failed.length > 0 ? { failed: result.failed.map(({ repo }) => repo) } : {}),
            },
          )
        }
        return res.status(result.ok ? 200 : 502).json({
          ...result,
          ...(result.ok
            ? {}
            : {
                error: `${result.done} ${pastTense}, ${result.failed.length} failed: ${result.failed
                  .map(({ repo, reason }) => `${repo} (${reason})`)
                  .join("; ")}`,
              }),
        })
      } catch (err) {
        log({ ok: false, error: err.message })
        return res.status(502).json({ error: err.message })
      }
    }
  }

  router.post(
    "/invitations/accept-all",
    bulkInvitationAction("acceptAll", "accepted", "invite_accept_all"),
  )
  router.post(
    "/invitations/decline-expired",
    bulkInvitationAction("declineExpired", "removed", "invite_decline_expired"),
  )

  return router
}

module.exports = { createApiRouter }
