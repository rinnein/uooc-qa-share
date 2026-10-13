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

// ── Auth tables (managed by better-auth, defined here for Drizzle awareness) ──

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  isAnonymous: boolean("is_anonymous").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
    questionId: text("question_id"),
    type: text("type").notNull(), // 'single' | 'multiple' | 'judge' | 'text'
    stem: text("stem"),
    stemHash: text("stem_hash"),
    stemEmbedding: vector("stem_embedding", { dimensions: 1536 }),
    options: jsonb("options"), // [{id, text}]
    blanks: integer("blanks").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("questions_tid_idx").on(t.tid),
    index("questions_stem_hash_idx").on(t.stemHash),
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
    submittedBy: text("submitted_by").references(() => users.id, {
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
