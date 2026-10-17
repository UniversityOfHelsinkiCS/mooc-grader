const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const {
  renderAnswerCell,
  renderGhaCell,
  renderChecksCell,
  renderActionCell,
} = require("../../src/views/cells")
const {
  renderOverviewPage,
  renderOverviewRow,
  renderSuotarRow,
  renderTabPage,
  renderCheatersPage,
} = require("../../src/views/pages")
const { answer } = require("../helpers")

const repo = "https://github.com/alice/app"

function courseResult(overrides = {}) {
  return {
    exerciseId: "ex1",
    courseId: null,
    name: "ci",
    gha: false,
    qr: false,
    linkCount: null,
    cheaterCount: null,
    answers: [],
    ...overrides,
  }
}

describe("renderAnswerCell", () => {
  test("escapes answer text", () => {
    const html = renderAnswerCell(["<script>alert(1)</script>"])
    assert.ok(!html.includes("<script>"))
    assert.ok(html.includes("&lt;script&gt;"))
  })

  test("links URLs and marks a missing repository", () => {
    const html = renderAnswerCell([repo], { repoUrl: repo, repoExists: false })
    assert.ok(html.includes(`<a href="${repo}" target="_blank"`))
    assert.ok(html.includes("no access"))
  })

  test("shows badges only next to the checked repository link", () => {
    const html = renderAnswerCell(["https://example.com", repo], {
      repoUrl: repo,
      qrExists: true,
    })
    const [otherLink, repoLink] = html.split("<br>")
    assert.ok(!otherLink.includes("qr-ok"))
    assert.ok(repoLink.includes("qr-ok"))
  })

  test("renders checkbox answers as marks", () => {
    const html = renderAnswerCell([
      "__CHECKED__:Own work",
      "__UNCHECKED__:Tests pass",
    ])
    assert.ok(html.includes('class="checkbox-ok" title="Own work"'))
    assert.ok(html.includes('class="checkbox-no" title="Tests pass"'))
  })

})

describe("renderGhaCell", () => {
  test("uses a known badge style for every status", () => {
    assert.ok(renderGhaCell(true, { conclusion: "no runs" }).includes('class="badge gha-neutral"'))
    assert.ok(renderGhaCell(true, null).includes('class="badge gha-neutral">n/a<'))
    assert.ok(
      renderGhaCell(true, { conclusion: "failure", branch: "main" }).includes(
        'class="badge gha-failure">failure (main)<',
      ),
    )
  })

  test("renders nothing when GHA is not checked", () => {
    assert.equal(renderGhaCell(false, null), "")
  })
})

describe("renderChecksCell", () => {
  test("fails when any check fails", () => {
    const html = renderChecksCell([
      { label: "Repo", ok: true },
      { label: "GHA", ok: false },
    ])
    assert.ok(html.includes(">FAIL<"))
    assert.ok(html.includes('title="Repo: OK, GHA: missing"'))
  })

  test("is unknown when a check could not be run", () => {
    const html = renderChecksCell([
      { label: "Repo", ok: true },
      { label: "QR", ok: null },
    ])
    assert.ok(html.includes(">?<"))
  })

  test("passes when all checks pass", () => {
    assert.ok(renderChecksCell([{ label: "Repo", ok: true }]).includes(">PASS<"))
  })
})

describe("renderActionCell", () => {
  test("main page offers full points, reset and zero points", () => {
    const html = renderActionCell({ itemId: "a1", exerciseId: "ex1", userId: "u1" })
    const actions = [...html.matchAll(/data-action="(\w+)"/g)].map((m) => m[1])
    assert.deepEqual(actions, ["FullPoints", "Reset", "ZeroPoints"])
  })

  test("a completion tab offers completion instead of full points", () => {
    const html = renderActionCell({
      itemId: "a1",
      exerciseId: "ex1",
      userId: "u1",
      grade: 4,
      completionTabId: "k8s",
    })
    const actions = [...html.matchAll(/data-action="(\w+)"/g)].map((m) => m[1])
    assert.deepEqual(actions, ["Completion", "ZeroPoints", "Reset"])
    assert.ok(
      html.includes(
        'data-user-id="u1" data-item-id="a1" data-exercise-id="ex1" data-tab-id="k8s" data-grade="4"',
      ),
    )
  })

  test("a pull request answer is offered Approve PR first", () => {
    const html = renderActionCell({
      itemId: "a1",
      exerciseId: "ex1",
      prUrl: "https://github.com/alice/app/pull/3",
    })
    const actions = [...html.matchAll(/data-action="(\w+)"/g)].map((m) => m[1])
    assert.deepEqual(actions, ["ApprovePr", "FullPoints", "Reset", "ZeroPoints"])
    assert.ok(
      html.includes('data-pr-url="https://github.com/alice/app/pull/3" data-exercise-id="ex1"'),
    )
  })

  test("flags the failed checks on the reset button for the reason picker", () => {
    const html = renderActionCell({
      itemId: "a1",
      exerciseId: "ex1",
      repoMissing: true,
      qrMissing: true,
    })
    const reset = html.match(/<button[^>]*data-action="Reset"[^>]*>/)[0]
    assert.ok(reset.includes('data-repo-missing="true"'))
    assert.ok(reset.includes('data-qr-missing="true"'))
    assert.ok(!reset.includes("data-gha-failed"))
    assert.ok(!reset.includes("data-links-missing"))
  })
})

describe("renderTabPage", () => {
  const fullstack = { id: "fs", name: "Full stack", courses: [] }
  const kubernetes = {
    id: "k8s",
    name: "Kubernetes",
    completion: { courseModuleId: "m", courseInstanceId: "i" },
    courses: [],
  }

  test("lists answers with the checks enabled for the course", () => {
    const item = {
      ...answer({ id: "a1", userId: "u1", texts: [repo] }),
      _repoUrl: repo,
      _repoExists: true,
      _ghaStatus: { conclusion: "failure", branch: "main" },
    }
    const html = renderTabPage(fullstack, [
      courseResult({ gha: true, answers: [item] }),
    ])

    assert.ok(html.includes("<h1>Full stack</h1>"))
    assert.ok(html.includes('<a href="/">&larr; Overview</a>'))
    assert.ok(html.includes("<th>GHA status</th>"))
    assert.ok(html.includes("failure (main)"))
    assert.ok(html.includes('data-gha-failed="true"'))
    assert.ok(html.includes('title="Repo: OK, GHA: missing"'))
    assert.ok(html.includes("<td>a1</td>"))
    assert.ok(!html.includes('data-action="Completion"'))
  })

  test("shows whether the pull request of an answer is approved", () => {
    const prAnswer = (id, approvedBy) => ({
      ...answer({ id, userId: "u1", texts: [`https://github.com/alice/app/pull/${id}`] }),
      _prUrl: `https://github.com/alice/app/pull/${id}`,
      _prApprovedBy: approvedBy,
    })
    const html = renderTabPage(fullstack, [
      courseResult({
        answers: [prAnswer("1", ["mluukkai"]), prAnswer("2", []), prAnswer("3", null)],
      }),
    ])

    assert.ok(html.includes('<span class="pr-approved">approved by mluukkai</span>'))
    assert.equal(html.match(/pr-not-approved/g).length, 1)
    const approveButtons = html.match(/<button[^>]*data-action="ApprovePr"[^>]*>/g)
    assert.equal(approveButtons.length, 3)
    assert.ok(approveButtons[0].includes("grade-btn-selected"))
    assert.ok(!approveButtons[1].includes("grade-btn-selected"))
    assert.ok(!approveButtons[2].includes("grade-btn-selected"))
  })

  test("offers accepting the answers whose checks all passed", () => {
    const passing = (id) => ({
      ...answer({ id, userId: "u1", texts: [repo] }),
      _repoUrl: repo,
      _repoExists: true,
      _ghaStatus: { conclusion: "success", branch: "main" },
    })
    const failing = { ...passing("a3"), _ghaStatus: { conclusion: "failure", branch: "main" } }
    const unknown = { ...passing("a4"), _ghaStatus: null }
    const noChecks = answer({ id: "a5", userId: "u1", texts: ["done"] })
    const html = renderTabPage(fullstack, [
      courseResult({ gha: true, answers: [passing("a1"), failing, unknown] }),
      courseResult({ name: "other", answers: [passing("a2"), noChecks] }),
      { name: "graphql", error: "down" },
    ])

    assert.ok(html.includes('data-count="2">Full points to all correct (2)</button>'))
    const correct = [...html.matchAll(/data-user-id="(\w+)" data-exercise-id="ex1" data-correct="true"/g)]
    assert.deepEqual(correct.map((m) => m[1]), ["a1", "a2"])
  })

  test("offers resetting the answers with a failed check", () => {
    const withGha = (id, conclusion) => ({
      ...answer({ id, userId: "u1", texts: [repo] }),
      _repoUrl: repo,
      _repoExists: true,
      _ghaStatus: { conclusion, branch: "main" },
    })
    const noAccess = { ...withGha("a4", "not found"), _repoExists: false }
    const html = renderTabPage(fullstack, [
      courseResult({
        gha: true,
        answers: [
          withGha("a1", "failure"),
          withGha("a2", "success"),
          withGha("a3", "in_progress"),
          noAccess,
          withGha("a5", "rate limited"),
        ],
      }),
    ])

    assert.ok(html.includes('data-count="2">Reset all incorrect (2)</button>'))
    const incorrect = [...html.matchAll(/<button[^>]*data-action="Reset"[^>]*>/g)]
      .filter((m) => m[0].includes('data-incorrect="true"'))
      .map((m) => m[0].match(/data-user-id="(\w+)"/)[1])
    assert.deepEqual(incorrect, ["a1", "a4"])
  })

  test("leaves resetting out when nothing is incorrect and on completion tabs", () => {
    assert.ok(!renderTabPage(fullstack, [courseResult()]).includes("reject-incorrect"))
    const item = {
      ...answer({ id: "a1", userId: "u1", texts: [repo] }),
      _repoUrl: repo,
      _repoExists: false,
    }
    assert.ok(
      renderTabPage(fullstack, [courseResult({ answers: [item] })]).includes("reject-incorrect"),
    )
    assert.ok(
      !renderTabPage(kubernetes, [courseResult({ answers: [item] })]).includes("reject-incorrect"),
    )
  })

  test("offers grading correct and incorrect at once only when there are both", () => {
    const item = (id, repoExists) => ({
      ...answer({ id, userId: "u1", texts: [repo] }),
      _repoUrl: repo,
      _repoExists: repoExists,
    })
    const html = renderTabPage(fullstack, [
      courseResult({ answers: [item("a1", true), item("a2", false), item("a3", false)] }),
    ])
    assert.ok(
      html.includes('data-count="3">Full points to correct, reset incorrect (1 + 2)</button>'),
    )
    assert.ok(
      !renderTabPage(fullstack, [courseResult({ answers: [item("a1", true)] })]).includes(
        "grade-all",
      ),
    )
    assert.ok(
      !renderTabPage(fullstack, [courseResult({ answers: [item("a1", false)] })]).includes(
        "grade-all",
      ),
    )
  })

  test("offers marking the flagged users of the tab honest, each course once", () => {
    const html = renderTabPage(fullstack, [
      courseResult({ courseId: "c1", cheaterCount: 2 }),
      courseResult({ courseId: "c1", cheaterCount: 2 }),
      courseResult({ courseId: "c2", cheaterCount: 1 }),
      courseResult({ courseId: "c3", cheaterCount: 0 }),
    ])
    assert.ok(html.includes('data-tab-id="fs" data-count="3">All flagged honest (3)</button>'))
    assert.ok(!renderTabPage(fullstack, [courseResult()]).includes("all-honest"))
  })

  test("leaves accepting out when nothing is correct and on completion tabs", () => {
    assert.ok(!renderTabPage(fullstack, [courseResult()]).includes("accept-correct"))
    const item = {
      ...answer({ id: "a1", userId: "u1", texts: [repo] }),
      _repoUrl: repo,
      _repoExists: true,
    }
    assert.ok(
      !renderTabPage(kubernetes, [courseResult({ answers: [item] })]).includes("accept-correct"),
    )
  })

  test("a completion tab lists users with their grade and the tab id", () => {
    const item = {
      ...answer({ id: "a1", userId: "u1", texts: ["done"] }),
      _coursePoints: 45,
      _userName: "Ada",
      _userEmail: "ada@x.fi",
    }
    const html = renderTabPage(kubernetes, [courseResult({ answers: [item] })])
    assert.ok(html.includes('<body class="compact" data-base-path="">'))
    assert.ok(
      html.includes("<td>u1</td><td>Ada</td><td>ada@x.fi</td><td>45</td><td>4</td>"),
    )
    assert.ok(html.includes('data-tab-id="k8s"'))
  })

  test("shows a course that failed to load", () => {
    const html = renderTabPage(fullstack, [
      { name: "graphql", error: "cookie <expired>" },
      courseResult({ name: "ci" }),
    ])
    assert.ok(
      html.includes(
        '<h2>graphql</h2><p class="load-error">Could not load: cookie &lt;expired&gt;</p>',
      ),
    )
    assert.ok(html.includes("<h2>ci <small>(0)</small>"))
  })

  test("links flagged cheaters", () => {
    const html = renderTabPage(fullstack, [
      courseResult({ courseId: "c1", cheaterCount: 2 }),
    ])
    assert.ok(html.includes('href="/cheaters/c1"'))
    assert.ok(html.includes("2 flagged"))
    assert.ok(html.includes("No answers."))
  })
})

describe("renderTabPage course filter", () => {
  const fullstack = { id: "fs", name: "Full stack", courses: [] }

  test("hides courses with nothing to do behind the show all toggle", () => {
    const html = renderTabPage(fullstack, [
      courseResult({ name: "extension", answers: [answer({ id: "a1", userId: "u1", texts: ["x"] })] }),
      courseResult({ name: "graphql" }),
      courseResult({ name: "ci", courseId: "c1", cheaterCount: 1 }),
      { name: "psql", error: "boom" },
    ])
    const sections = [...html.matchAll(/<section class="([^"]+)"><h2>(\w+)/g)].map(
      (m) => [m[2], m[1]],
    )
    assert.deepEqual(sections, [
      ["extension", "course"],
      ["graphql", "course quiet"],
      ["ci", "course"],
      ["psql", "course"],
    ])
    assert.ok(html.includes('id="show-all-courses"'))
    assert.ok(html.includes("Show all courses (1 without anything to do)"))
    assert.ok(!html.includes("Nothing requires attention."))
  })

  test("says so when no course needs attention", () => {
    const html = renderTabPage(fullstack, [courseResult({ name: "graphql" })])
    assert.ok(html.includes("Nothing requires attention."))
  })

  test("leaves the toggle out when every course needs attention", () => {
    const html = renderTabPage(fullstack, [{ name: "psql", error: "boom" }])
    assert.ok(!html.includes("show-all-courses"))
  })
})

describe("renderTabPage pull request answers", () => {
  const tab = { id: "pull-requests", name: "Pull requests", courses: [] }

  test("flags Reset when the answer is not a pull request link", () => {
    const html = renderTabPage(tab, [
      courseResult({ pr: true, answers: [answer({ id: "a1", userId: "u1", texts: ["x"] })] }),
    ])
    assert.ok(html.includes('data-pr-missing="true"'))
    assert.ok(html.includes("the answer must be a link to a pull request"))
  })

  test("does not flag Reset when the answer has a pull request link", () => {
    const item = answer({ id: "a1", userId: "u1", texts: ["https://github.com/a/b/pull/1"] })
    item._prUrl = "https://github.com/a/b/pull/1"
    const html = renderTabPage(tab, [courseResult({ pr: true, answers: [item] })])
    assert.ok(!html.includes("data-pr-missing"))
  })

  test("an approved pull request is correct, a missing one incorrect, others undecided", () => {
    const withPr = (id, approvedBy) => ({
      ...answer({ id, userId: "u1", texts: ["pr"] }),
      _prUrl: `https://github.com/a/b/pull/${id}`,
      _prApprovedBy: approvedBy,
    })
    const html = renderTabPage(tab, [
      courseResult({
        pr: true,
        answers: [
          withPr("a1", ["mluukkai"]),
          withPr("a2", []),
          withPr("a3", null),
          answer({ id: "a4", userId: "u1", texts: ["x"] }),
        ],
      }),
    ])
    const marked = (attribute) =>
      [...html.matchAll(/<button[^>]*>/g)]
        .filter((m) => m[0].includes(`data-${attribute}="true"`))
        .map((m) => m[0].match(/data-user-id="(\w+)"/)[1])
    assert.deepEqual(marked("correct"), ["a1"])
    assert.deepEqual(marked("incorrect"), ["a4"])
    assert.ok(html.includes("Full points to correct, reset incorrect (1 + 1)"))
  })
})

describe("renderTabPage user id toggle", () => {
  test("renders user ids hidden behind a toggle", () => {
    const tab = { id: "docker", name: "Docker", courses: [] }
    const html = renderTabPage(tab, [
      courseResult({ answers: [answer({ id: "a1", userId: "u1", texts: ["x"] })] }),
    ])
    assert.ok(html.includes('id="show-user-ids"'))
    assert.ok(html.includes('<th class="user-id">User ID</th>'))
    assert.ok(html.includes('<td class="user-id">u1</td>'))
  })

  test("leaves the toggle out on tabs with completions", () => {
    const tab = { id: "fs", name: "Full stack", courses: [], completion: {} }
    const html = renderTabPage(tab, [courseResult({ answers: [] })])
    assert.ok(!html.includes("show-user-ids"))
  })
})

describe("renderOverviewPage", () => {
  test("is sent with a loading row per tab, account and Suotar link", () => {
    const html = renderOverviewPage(
      [
        { id: "k8s", name: "Kubernetes" },
        { id: "fs", name: "Full stack" },
      ],
      { basePath: "/g", invitationAccounts: [{ index: 0, label: "primary" }] },
    )
    const spinner = '<span class="spinner" role="status" aria-label="Loading"></span>'
    assert.ok(
      html.includes(
        `<tr data-row-url="/g/overview/tabs/k8s"><td><a href="/g/k8s">Kubernetes</a></td><td>${spinner}</td><td>${spinner}</td></tr>`,
      ),
    )
    assert.ok(html.includes('<tr data-row-url="/g/overview/tabs/fs">'))
    assert.ok(
      html.includes(`<tr data-row-url="/g/overview/invites/0"><td>primary</td><td>${spinner}</td>`),
    )
    assert.ok(html.includes('<tr data-row-url="/g/overview/suotar/0">'))
    assert.ok(html.includes('<tr data-row-url="/g/overview/suotar/1">'))
    assert.ok(html.includes('<script src="/g/static/overview.js"></script>'))
  })

  test("offers grading every tab without completions", () => {
    const html = renderOverviewPage([
      { id: "k8s", name: "Kubernetes", completion: { courseModuleId: "m", courseInstanceId: "i" } },
      { id: "fs", name: "Full stack" },
      { id: "docker", name: "Docker" },
    ])
    assert.ok(
      html.includes(
        'data-tabs="fs,docker">Full points to correct, reset incorrect: Full stack, Docker</button>',
      ),
    )
    assert.ok(!renderOverviewPage([]).includes("grade-all-tabs"))
  })

  test("lists the tabs with completions in a table of their own", () => {
    const html = renderOverviewPage([
      { id: "fs", name: "Full stack" },
      { id: "k8s", name: "Kubernetes", completion: { courseModuleId: "m", courseInstanceId: "i" } },
    ])
    const manual = html.indexOf("<h1>Manual grading</h1>")
    assert.ok(manual > html.indexOf('href="/fs"'))
    assert.ok(manual < html.indexOf('href="/k8s"'))
    assert.ok(!renderOverviewPage([{ id: "fs", name: "Full stack" }]).includes("Manual grading"))
  })

  test("leaves the invitations out without an invitation service", () => {
    const html = renderOverviewPage([])
    assert.ok(!html.includes("GitHub invitations"))
    assert.ok(html.includes("<h1>Suotar</h1>"))
  })

  test("links the Suotar pages", () => {
    const html = renderOverviewPage([])
    assert.ok(html.includes("<th>Course</th><th>Completions</th>"))
    assert.ok(
      html.includes('href="https://studies.cs.helsinki.fi/stats/courses/fullstackopen/admin/suotar"'),
    )
    assert.ok(
      html.includes('href="https://study.cs.helsinki.fi/stats/courses/akateemiset-taidot/admin/suotar"'),
    )
  })
})

describe("renderOverviewRow", () => {
  test("shows the totals of a tab", () => {
    assert.equal(
      renderOverviewRow({ id: "k8s", name: "Kubernetes", answerCount: 4, cheaterCount: 0, failed: [] }, ""),
      '<tr><td><a href="/k8s">Kubernetes</a></td><td>4</td><td></td></tr>',
    )
    const html = renderOverviewRow(
      { id: "fs", name: "Full stack", answerCount: 11, cheaterCount: 3, failed: [] },
      "",
    )
    assert.ok(html.includes('<td>11</td><td><span class="badge s-flagged">3 flagged</span></td>'))
  })

  test("names the courses that could not be counted", () => {
    const html = renderOverviewRow(
      {
        id: "fs",
        name: "Full stack",
        answerCount: 1,
        cheaterCount: 0,
        failed: [{ name: "graphql", error: "cookie <expired>" }],
      },
      "",
    )
    assert.ok(html.includes("Could not load: graphql (cookie &lt;expired&gt;)"))
  })
})

describe("renderSuotarRow", () => {
  const link = { name: "Akateemiset taidot", url: "https://stats.test/suotar" }

  test("shows the count of completions waiting for Suotar", () => {
    assert.ok(renderSuotarRow(link, 4).endsWith("Akateemiset taidot</a></td><td>4</td></tr>"))
    assert.ok(renderSuotarRow(link, 0).endsWith("</a></td><td>0</td></tr>"))
  })

  test("tells when the count could not be loaded", () => {
    assert.ok(renderSuotarRow(link, null).includes('<td class="load-error">Could not load</td>'))
  })
})

describe("renderCheatersPage", () => {
  test("passes the course id to the browser script", () => {
    const html = renderCheatersPage("graphql", [], "c1")
    assert.ok(html.includes('data-course-id="c1"'))
    assert.ok(html.includes("No flagged users."))
  })

  test("lists flagged users and their submissions", () => {
    const html = renderCheatersPage(
      "graphql",
      [
        {
          userId: "u1",
          name: "Ada",
          email: null,
          durationMinutes: 3,
          totalPoints: 30,
          submissions: [repo, "<b>text</b>"],
        },
      ],
      "c1",
    )
    assert.ok(html.includes(`<a href="${repo}"`))
    assert.ok(html.includes("&lt;b&gt;text&lt;/b&gt;"))
    assert.ok(html.includes('data-action="confirm" data-user-id="u1"'))
  })
})
