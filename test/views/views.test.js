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

describe("renderOverviewPage", () => {
  test("links every tab with its totals", () => {
    const html = renderOverviewPage([
      { id: "k8s", name: "Kubernetes", answerCount: 4, cheaterCount: 0, failed: [] },
      { id: "fs", name: "Full stack", answerCount: 11, cheaterCount: 3, failed: [] },
    ])
    assert.ok(
      html.includes('<tr><td><a href="/k8s">Kubernetes</a></td><td>4</td><td></td></tr>'),
    )
    assert.ok(html.includes('<a href="/fs">Full stack</a>'))
    assert.ok(html.includes('<td>11</td><td><span class="badge s-flagged">3 flagged</span></td>'))
  })

  test("names the courses that could not be counted", () => {
    const html = renderOverviewPage([
      {
        id: "fs",
        name: "Full stack",
               answerCount: 1,
        cheaterCount: 0,
        failed: [{ name: "graphql", error: "cookie <expired>" }],
      },
    ])
    assert.ok(html.includes("Could not load: graphql (cookie &lt;expired&gt;)"))
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
