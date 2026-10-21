import { describe, it, expect, vi } from "vite-plus/test";
import {
  normalizeJudgeValue,
  normalizeChoiceAnswers,
  areAnswerValuesEqual,
  uploadRoutes,
} from "./upload";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue({}),
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({}),
    }),
    query: {
      questions: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      answers: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    execute: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("@/lib/embedding", () => ({
  EMBEDDING_DIMENSIONS: 512,
  resolveEmbedding: vi.fn().mockResolvedValue(null),
}));

describe("normalizeJudgeValue", () => {
  it("normalizes truthy judge values to true", () => {
    expect(normalizeJudgeValue(true)).toBe(true);
    expect(normalizeJudgeValue("true")).toBe(true);
    expect(normalizeJudgeValue("A")).toBe(true);
    expect(normalizeJudgeValue("正确")).toBe(true);
    expect(normalizeJudgeValue("对")).toBe(true);
    expect(normalizeJudgeValue("1")).toBe(true);
    expect(normalizeJudgeValue(1)).toBe(true);
    expect(normalizeJudgeValue("A. 正确")).toBe(true);
  });

  it("normalizes falsy judge values to false", () => {
    expect(normalizeJudgeValue(false)).toBe(false);
    expect(normalizeJudgeValue("false")).toBe(false);
    expect(normalizeJudgeValue("B")).toBe(false);
    expect(normalizeJudgeValue("错误")).toBe(false);
    expect(normalizeJudgeValue("错")).toBe(false);
    expect(normalizeJudgeValue("0")).toBe(false);
    expect(normalizeJudgeValue(0)).toBe(false);
    expect(normalizeJudgeValue("B. 错误")).toBe(false);
  });

  it("returns null for unrecognized values", () => {
    expect(normalizeJudgeValue("invalid")).toBe(null);
    expect(normalizeJudgeValue("C")).toBe(null);
  });
});

describe("normalizeChoiceAnswers", () => {
  const options = [
    { id: "A", text: "苹果" },
    { id: "B", text: "香蕉" },
    { id: "C", text: "ALphaGo围棋比赛大获全胜" },
  ];

  it("keeps option id as is when already id", () => {
    expect(normalizeChoiceAnswers(["A"], options)).toEqual(["A"]);
    expect(normalizeChoiceAnswers(["B", "C"], options)).toEqual(["B", "C"]);
  });

  it("maps option text to option id and does not retain text", () => {
    expect(normalizeChoiceAnswers(["香蕉"], options)).toEqual(["B"]);
    expect(normalizeChoiceAnswers(["ALphaGo围棋比赛大获全胜"], options)).toEqual(["C"]);
    expect(normalizeChoiceAnswers(["苹果", "香蕉"], options)).toEqual(["A", "B"]);
  });

  it("maps prefixed strings like 'A. 苹果' to option id", () => {
    expect(normalizeChoiceAnswers(["A. 苹果"], options)).toEqual(["A"]);
    expect(normalizeChoiceAnswers(["B、香蕉"], options)).toEqual(["B"]);
  });
});

describe("areAnswerValuesEqual", () => {
  it("compares answer value arrays regardless of ordering", () => {
    expect(areAnswerValuesEqual(["A", "C"], ["C", "A"])).toBe(true);
    expect(areAnswerValuesEqual(["A"], ["A"])).toBe(true);
    expect(areAnswerValuesEqual([true], ["true"])).toBe(true);
    expect(areAnswerValuesEqual(["A"], ["B"])).toBe(false);
    expect(areAnswerValuesEqual(["A", "B"], ["A"])).toBe(false);
  });
});

describe("POST /upload/batch validation", () => {
  it("rejects request if stem contains HTML tags", async () => {
    const res = await uploadRoutes.handle(
      new Request("http://localhost/upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid: "1001",
          questions: [
            {
              question_id: "q1",
              type: "single",
              stem: "<p>带有 HTML 标签的题干</p>",
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("题干包含未过滤的 HTML 标签");
  });

  it("rejects request if option text contains HTML tags", async () => {
    const res = await uploadRoutes.handle(
      new Request("http://localhost/upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid: "1001",
          questions: [
            {
              question_id: "q2",
              type: "single",
              stem: "纯文本题干",
              options: [{ id: "A", text: "<span>带有 span 的选项</span>" }],
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("选项包含未过滤的 HTML 标签");
  });

  it("allows single choice with multiple answers when marking multiple tentative/wrong answers", async () => {
    const res = await uploadRoutes.handle(
      new Request("http://localhost/upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid: "1001",
          questions: [
            {
              question_id: "q_single_multi",
              type: "single",
              stem: "单选题暂未确认唯一正确答案",
              options: [
                { id: "A", text: "选项A" },
                { id: "B", text: "选项B" },
                { id: "C", text: "选项C" },
              ],
              values: ["A", "B"],
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("rejects choice question with duplicate answers", async () => {
    const res = await uploadRoutes.handle(
      new Request("http://localhost/upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid: "1001",
          questions: [
            {
              question_id: "q_multi_dup",
              type: "multiple",
              stem: "多选题",
              options: [
                { id: "A", text: "选项A" },
                { id: "B", text: "选项B" },
                { id: "C", text: "选项C" },
              ],
              values: ["A", "B", "A"],
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("包含重复项 'A'");
  });

  it("rejects choice question with answers not in options[].id", async () => {
    const res = await uploadRoutes.handle(
      new Request("http://localhost/upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid: "1001",
          questions: [
            {
              question_id: "q_not_in_options",
              type: "single",
              stem: "单选题",
              options: [
                { id: "A", text: "选项A" },
                { id: "B", text: "选项B" },
              ],
              values: ["C"],
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("不在选项 options[].id 列表中");
  });

  it("rejects judge question with multiple answers or invalid values", async () => {
    const res1 = await uploadRoutes.handle(
      new Request("http://localhost/upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid: "1001",
          questions: [
            {
              question_id: "q_judge_multi",
              type: "judge",
              stem: "判断题",
              values: [true, false],
            },
          ],
        }),
      }),
    );

    expect(res1.status).toBe(400);
    const data1 = await res1.json();
    expect(data1.ok).toBe(false);
    expect(data1.error).toContain("判断题，答案必须有且仅有 1 个值");

    const res2 = await uploadRoutes.handle(
      new Request("http://localhost/upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid: "1001",
          questions: [
            {
              question_id: "q_judge_invalid",
              type: "judge",
              stem: "判断题",
              values: ["未知答案"],
            },
          ],
        }),
      }),
    );

    expect(res2.status).toBe(400);
    const data2 = await res2.json();
    expect(data2.ok).toBe(false);
    expect(data2.error).toContain("判断题答案值 '未知答案' 无效");
  });

  it("rejects text question when declared blanks does not match values count", async () => {
    const res = await uploadRoutes.handle(
      new Request("http://localhost/upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid: "1001",
          questions: [
            {
              question_id: "q_text_mismatch",
              type: "text",
              stem: "填空题含两空____和____",
              blanks: 2,
              values: ["只有一空答案"],
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("填空题声明空数 (2) 与提供的答案数组长度 (1) 不一致");
  });

  it("successfully processes valid clean upload with fill-in-the-blank, judge, and single choice", async () => {
    const res = await uploadRoutes.handle(
      new Request("http://localhost/upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid: "1001",
          questions: [
            {
              question_id: "q_text",
              type: "text",
              stem: "微积分基本公式又称____公式",
              blanks: 1,
              values: ["牛顿-莱布尼茨"],
            },
            {
              question_id: "q_judge",
              type: "judge",
              stem: "初等函数在其定义域内均连续",
              correct_answers: [true],
            },
            {
              question_id: "q_single",
              type: "single",
              stem: "单选题干",
              options: [
                { id: "A", text: "苹果" },
                { id: "B", text: "香蕉" },
              ],
              correct_answers: ["香蕉"],
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.results).toHaveLength(3);

    const { resolveEmbedding } = await import("@/lib/embedding");
    expect(resolveEmbedding).toHaveBeenCalledWith(
      "单选题干",
      [
        { id: "A", text: "苹果" },
        { id: "B", text: "香蕉" },
      ],
      undefined,
    );
  });

  it("permits anonymous users to add correct answers and wrong answers to questions without correct answers (new write)", async () => {
    // When existing question has no correct answer
    mockDb.query.questions.findFirst.mockResolvedValueOnce({
      id: 317,
      tid: "246803016",
      questionId: "149379890",
      type: "single",
      stem: "测试题干317",
      options: [
        { id: "A", text: "选项A" },
        { id: "B", text: "选项B" },
      ],
    });
    // No correct answer exists in DB
    mockDb.query.answers.findFirst.mockResolvedValueOnce(null);

    const res = await uploadRoutes.handle(
      new Request("http://localhost/upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid: "246803016",
          questions: [
            {
              question_id: "149379890",
              type: "single",
              options: [
                { id: "A", text: "选项A" },
                { id: "B", text: "选项B" },
              ],
              correct_answers: ["B"],
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.results[0]).toEqual({
      question_id: "149379890",
      action: "added_correct",
      internal_id: 317,
    });
  });

  it("recognizes re-submitting the same correct answer as verified_correct, not denied_anonymous_overwrite", async () => {
    // Existing question
    mockDb.query.questions.findFirst.mockResolvedValueOnce({
      id: 317,
      tid: "246803016",
      questionId: "149379890",
      type: "single",
      options: [
        { id: "A", text: "选项A" },
        { id: "B", text: "选项B" },
      ],
    });
    // Existing correct answer is "B"
    mockDb.query.answers.findFirst.mockResolvedValueOnce({
      id: 99,
      questionId: 317,
      values: ["B"],
      isCorrect: true,
    });

    const res = await uploadRoutes.handle(
      new Request("http://localhost/upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid: "246803016",
          questions: [
            {
              question_id: "149379890",
              type: "single",
              options: [
                { id: "A", text: "选项A" },
                { id: "B", text: "选项B" },
              ],
              correct_answers: ["B"],
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.results[0].action).toBe("verified_correct");
  });

  it("denies anonymous user from overwriting an existing different correct answer", async () => {
    // Existing question
    mockDb.query.questions.findFirst.mockResolvedValueOnce({
      id: 317,
      tid: "246803016",
      questionId: "149379890",
      type: "single",
      options: [
        { id: "A", text: "选项A" },
        { id: "B", text: "选项B" },
      ],
    });
    // Existing correct answer is "A"
    mockDb.query.answers.findFirst.mockResolvedValueOnce({
      id: 99,
      questionId: 317,
      values: ["A"],
      isCorrect: true,
    });

    const res = await uploadRoutes.handle(
      new Request("http://localhost/upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid: "246803016",
          questions: [
            {
              question_id: "149379890",
              type: "single",
              options: [
                { id: "A", text: "选项A" },
                { id: "B", text: "选项B" },
              ],
              correct_answers: ["B"],
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.results[0].action).toBe("denied_anonymous_overwrite");
  });
});
