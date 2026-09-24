const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const { getItemTexts, findGithubText } = require("../../src/domain/answers")

describe("getItemTexts", () => {
  test("returns trimmed text answers and skips blank ones", () => {
    const item = {
      data_json: {
        itemAnswers: [
          { textData: "  https://github.com/a/b  " },
          { textData: "   " },
          { textData: null },
        ],
      },
    }
    assert.deepEqual(getItemTexts(item), ["https://github.com/a/b"])
  })

  test("encodes checkbox answers with the quiz item title", () => {
    const item = {
      data_json: {
        itemAnswers: [
          { quizItemId: "q1", checked: true },
          { quizItemId: "q2", checked: false },
        ],
      },
      tasks: [
        {
          public_spec: {
            items: [
              { id: "q1", title: "I did it myself" },
              { id: "q2", title: "Tests pass" },
            ],
          },
        },
      ],
    }
    assert.deepEqual(getItemTexts(item), [
      "__CHECKED__:I did it myself",
      "__UNCHECKED__:Tests pass",
    ])
  })

  test("falls back to the quiz item id when the title is unknown", () => {
    const item = {
      data_json: { itemAnswers: [{ quizItemId: "q9", checked: true }] },
    }
    assert.deepEqual(getItemTexts(item), ["__CHECKED__:q9"])
  })

  test("includes previous submissions of tasks and removes duplicates", () => {
    const item = {
      data_json: { itemAnswers: [{ textData: "https://github.com/a/b" }] },
      tasks: [
        {
          previous_submission: {
            data_json: {
              itemAnswers: [
                { textData: "https://github.com/a/b" },
                { textData: "https://github.com/a/c" },
              ],
            },
          },
        },
      ],
    }
    assert.deepEqual(getItemTexts(item), [
      "https://github.com/a/b",
      "https://github.com/a/c",
    ])
  })

  test("handles items without answers", () => {
    assert.deepEqual(getItemTexts({}), [])
  })
})

describe("findGithubText", () => {
  test("returns the first text mentioning github.com", () => {
    const texts = ["my app", "https://github.com/a/b", "https://github.com/c/d"]
    assert.equal(findGithubText(texts), "https://github.com/a/b")
  })

  test("returns null when there is no GitHub link", () => {
    assert.equal(findGithubText(["https://gitlab.com/a/b"]), null)
  })
})
