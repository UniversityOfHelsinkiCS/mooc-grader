const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const {
  allCourses,
  findTab,
  findCourseByExercise,
  findCheatersCourse,
  validateTabs,
} = require("../../src/config/tabs")
const { tabs: configuredTabs } = require("../../src/config/courses")

const tabs = [
  {
    id: "k8s",
    name: "Kubernetes",
    completion: { courseModuleId: "m", courseInstanceId: "i" },
    courses: [{ exerciseId: "e1", name: "kubernetes", courseId: "c1" }],
  },
  {
    id: "fs",
    name: "Full stack",
    courses: [
      { exerciseId: "e2", name: "graphql", courseId: "c2", cheaters: true },
      { exerciseId: "e3", name: "ci", courseId: "c3" },
    ],
  },
]

describe("tab lookups", () => {
  test("find tabs and courses across all tabs", () => {
    assert.deepEqual(allCourses(tabs).map((c) => c.exerciseId), ["e1", "e2", "e3"])
    assert.equal(findTab(tabs, "fs").name, "Full stack")
    assert.equal(findTab(tabs, "nope"), null)
    assert.equal(findCourseByExercise(tabs, "e1").name, "kubernetes")
    assert.equal(findCourseByExercise(tabs, "nope"), null)
  })

  test("only courses with the cheaters feature are cheater courses", () => {
    assert.equal(findCheatersCourse(tabs, "c2").name, "graphql")
    assert.equal(findCheatersCourse(tabs, "c3"), null)
  })
})

describe("validateTabs", () => {
  test("accepts the configured tabs", () => {
    assert.equal(validateTabs(configuredTabs), configuredTabs)
  })

  test("reports every configuration mistake at once", () => {
    const broken = [
      { id: "Bad Id", name: "x", courses: [] },
      { id: "cheaters", name: "y", courses: [] },
      {
        id: "k8s",
        name: "a",
        completion: { courseModuleId: "m" },
        courses: [{ exerciseId: "e1", name: "no course id" }],
      },
      {
        id: "k8s",
        name: "b",
        courses: [{ exerciseId: "e1", name: "cheaters", cheaters: true }],
      },
    ]
    assert.throws(
      () => validateTabs(broken),
      (error) => {
        for (const problem of [
          'tab id "Bad Id"',
          'duplicate tab id "k8s"',
          'tab id "cheaters" is reserved for another route',
          "completion needs courseModuleId and courseInstanceId",
          'course "no course id" in tab "k8s" needs courseId',
          "exercise e1 is in more than one course",
          'course "cheaters" in tab "k8s" needs courseId',
        ]) {
          assert.ok(error.message.includes(problem), problem)
        }
        return true
      },
    )
  })
})
