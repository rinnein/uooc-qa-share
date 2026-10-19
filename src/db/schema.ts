import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  real,
  timestamp,
  jsonb,
  index,
  unique,
  vector,
} from "drizzle-orm/pg-core";

// Re-export all Better Auth schema tables and relations
export * from "./auth-schema.ts";
import { user } from "./auth-schema.ts";

// Backwards-compatible aliases
export { user as users };
export { session as sessions } from "./auth-schema.ts";
export { account as accounts } from "./auth-schema.ts";
export { verification as verifications } from "./auth-schema.ts";

// ── Application tables ──

export const courses = pgTable("courses", {
  cid: text("cid").primaryKey(),
  name: text("name"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const taskGroups = pgTable(
  "task_groups",
  {
    tid: text("tid").primaryKey(),
    cid: text("cid")
      .notNull()
      .references(() => courses.cid, { onDelete: "cascade" }),
    name: text("name"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("task_groups_cid_idx").on(t.cid)],
);

export const questions = pgTable(
  "questions",
  {
    id: serial("id").primaryKey(),
    tid: text("tid")
      .notNull()
      .references(() => taskGroups.tid, { onDelete: "cascade" }),
    // UOOC 题单中的真实单题 ID (对应 /exam/getTaskPaper 接口返回的 data.questions[].id)
    questionId: text("question_id").notNull(),
    type: text("type").notNull(), // 'single' | 'multiple' | 'judge' | 'text'
    stem: text("stem"),
    stemHash: text("stem_hash"),
    stemEmbedding: vector("stem_embedding", { dimensions: 512 }),
    options: jsonb("options"), // [{id, text}]
    blanks: integer("blanks").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("questions_tid_idx").on(t.tid),
    index("questions_stem_hash_idx").on(t.stemHash),
    index("questions_question_id_idx").on(t.questionId),
    unique("questions_tid_qid_uniq").on(t.tid, t.questionId),
  ],
);

export const answers = pgTable(
  "answers",
  {
    id: serial("id").primaryKey(),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    values: jsonb("values").notNull(), // ["A","C"] or ["填空内容"]
    source: text("source").notNull().default("user"), // 'user' | 'plugin' | 'mcp'
    submittedBy: text("submitted_by").references(() => user.id, {
      onDelete: "set null",
    }),
    confidence: real("confidence").notNull().default(0.5),
    isCorrect: boolean("is_correct").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("answers_question_id_idx").on(t.questionId),
    index("answers_question_correct_idx").on(t.questionId, t.isCorrect),
  ],
);
