const { buildGradingDecision } = require("../domain/grading")
const {
  answerChecks,
  isCorrect,
  isIncorrect,
  resetReason,
} = require("../domain/answerChecks")
const { noActionLog } = require("../infra/actionLog")

// The actor of the log rows of scheduled runs
const AUTO_GRADER_ACTOR = "node-cron"

const GRADE_LOG_ACTIONS = { FullPoints: "full_points", Other: "reset" }

// What the "Doit all" button of the overview page does, run on the server
// without anyone confirming: accepts the open GitHub invitations, approves
// the pull requests waiting for approval and gives them full points, gives
// full points to the correct answers and resets the incorrect ones with the
// reason of their failed check. Tabs with completions are graded by hand
// and left out. Everything is done one at a time so that mooc.fi and GitHub
// are not flooded, and logged as done by node-cron.
function createAutoGrader({
  tabs,
  mooc,
  courseService,
  invitationService = null,
  pullRequestService = null,
  actionLog = noActionLog,
}) {
  const record = (entry) => actionLog.log({ actor_uid: AUTO_GRADER_ACTOR, ...entry })

  async function acceptInvitations(totals) {
    for (const { index, label } of invitationService?.listAccounts() ?? []) {
      try {
        const result = await invitationService.acceptAll(index)
        if (result.error) throw new Error(result.error)
        totals.invitations += result.done
        totals.failed += result.failed.length
        if (result.done > 0 || result.failed.length > 0) {
          record({
            action: "invite_accept_all",
            details: {
              account: label,
              done: result.done,
              ...(result.failed.length > 0 ? { failed: result.failed.map(({ repo }) => repo) } : {}),
            },
            ok: result.ok,
            error: result.ok ? null : `${result.failed.length} failed`,
          })
        }
      } catch (err) {
        totals.failed++
        record({ action: "invite_accept_all", details: { account: label }, ok: false, error: err.message })
      }
    }
  }

  // Resolves to true when mooc.fi took the grade
  async function grade(target, action, justification = null) {
    const { payload, error } = buildGradingDecision({
      user_exercise_state_id: target.item.id,
      exercise_id: target.course.exerciseId,
      action,
      justification,
    })
    const outcome = error
      ? { ok: false, error }
      : await mooc.postGradingDecision(payload).then(
          (response) => {
            const ok = response.status >= 200 && response.status < 300
            return { ok, error: ok ? null : `${response.status}` }
          },
          (err) => ({ ok: false, error: err.message }),
        )
    record({
      action: GRADE_LOG_ACTIONS[action],
      ...targetColumns(target),
      target_answer_id: target.item.id,
      details: justification ? { justification } : null,
      ...outcome,
    })
    return outcome.ok
  }

  // Resolves to true when the pull request was approved
  async function approve(target) {
    const prUrl = target.item._prUrl
    const result = await pullRequestService
      .approve(prUrl)
      .catch((err) => ({ error: err.message }))
    record({
      action: "approve_pr",
      ...targetColumns(target),
      details: { pr_url: prUrl, ...(result.label ? { account: result.label } : {}) },
      ok: !result.error,
      error: result.error ?? null,
    })
    return !result.error
  }

  // { approve, accept, reset } targets of the graded tabs; a tab or course
  // that cannot be loaded is reported in notLoaded
  async function findTargets() {
    const found = { approve: [], accept: [], reset: [], notLoaded: [] }
    for (const tab of tabs.filter((item) => !item.completion)) {
      let courses
      try {
        courses = await courseService.fetchTabData(tab)
      } catch (err) {
        found.notLoaded.push(`${tab.id} (${err.message})`)
        continue
      }
      for (const course of courses) {
        if (course.error) {
          found.notLoaded.push(`${tab.id}/${course.name} (${course.error})`)
          continue
        }
        for (const item of course.answers) {
          const target = { tab, course, item }
          const verdict = judge(item, course)
          if (verdict) found[verdict].push(target)
        }
      }
    }
    return found
  }

  let running = false

  // Resolves to the totals of the run, or null when a run is going already
  async function run() {
    if (running) return null
    running = true
    const totals = { invitations: 0, approved: 0, full_points: 0, reset: 0, failed: 0 }
    let notLoaded = []
    try {
      await acceptInvitations(totals)
      const targets = await findTargets()
      notLoaded = targets.notLoaded

      for (const target of targets.approve) {
        if ((await approve(target)) && (await grade(target, "FullPoints"))) {
          totals.approved++
        } else {
          totals.failed++
        }
      }
      for (const target of targets.accept) {
        if (await grade(target, "FullPoints")) totals.full_points++
        else totals.failed++
      }
      for (const target of targets.reset) {
        if (await grade(target, "Other", resetReason(target.item, target.course))) totals.reset++
        else totals.failed++
      }
    } catch (err) {
      notLoaded.push(err.message)
    } finally {
      running = false
    }

    // One row per run, also when there was nothing to do, so that the log
    // shows the schedule is alive
    record({
      action: "auto_grade_run",
      details: { ...totals, ...(notLoaded.length > 0 ? { not_loaded: notLoaded } : {}) },
      ok: totals.failed === 0 && notLoaded.length === 0,
      error: notLoaded.length > 0 ? `could not load: ${notLoaded.join(", ")}` : null,
    })
    return { ...totals, notLoaded }
  }

  return { run }
}

function targetColumns({ tab, course, item }) {
  return {
    tab_id: tab.id,
    course_id: course.courseId,
    exercise_id: course.exerciseId,
    target_user_id: item.user_id ?? null,
  }
}

// "approve", "accept", "reset" or null for an answer left as it is.
// A pull request waiting for approval is approved only when every other
// check of the answer passed, so that e.g. a pull request whose tests are
// still running is not approved unattended. An answer with an approved pull
// request is never reset, as on the tab page.
function judge(item, course) {
  const prApproved = item._prApprovedBy?.length > 0
  if (course.pr && item._prUrl && !prApproved) {
    const others = answerChecks(item, course).filter((check) => check.label !== "PR")
    if (others.every((check) => check.ok === true)) return "approve"
  }
  if (isCorrect(item, course)) return "accept"
  if (isIncorrect(item, course) && !prApproved && resetReason(item, course)) return "reset"
  return null
}

module.exports = { createAutoGrader, AUTO_GRADER_ACTOR }
