import { db } from "@/db";
import { questions, taskGroups, courses, answers, users } from "@/db/schema";
import { eq, and, or, isNull, sql, inArray } from "drizzle-orm";

export type TaskType = "stem_request" | "embedding_request" | "options_request" | "answer_request";

export type WritePermissionLevel = "none" | "anonymous" | "authenticated" | "admin";

export interface UserAuthContext {
  userId: string | null;
  isAnonymous: boolean;
  permissionLevel: WritePermissionLevel;
  permissions: string[];
}

/**
 * Resolve user authentication and their write permission level.
 */
export async function resolveUserAuth(request: Request): Promise<UserAuthContext> {
  const { auth } = await import("@/lib/auth");
  let userId: string | null = null;
  let isAnonymous = true;
  let permissionList: string[] = [];

  // Check if an explicit API key is provided
  const apiKey =
    request.headers.get("x-api-key") ||
    request.headers.get("api-key") ||
    (request.headers.get("authorization")?.startsWith("Bearer ")
      ? request.headers.get("authorization")!.slice(7).trim()
      : null);

  // If apiKey is present, verify it once directly to extract key permissions without double increment
  if (apiKey) {
    try {
      const verified = await auth.api.verifyApiKey({ body: { key: apiKey } });
      if (verified?.valid && verified.key?.referenceId) {
        userId = verified.key.referenceId;
        if (verified.key.permissions) {
          const rawPermissions = verified.key.permissions;
          if (typeof rawPermissions === "string") {
            try {
              const parsed = JSON.parse(rawPermissions);
              if (Array.isArray(parsed)) {
                permissionList = parsed;
              } else {
                permissionList = [rawPermissions];
              }
            } catch {
              permissionList = [rawPermissions];
            }
          } else if (typeof rawPermissions === "object" && rawPermissions !== null) {
            permissionList = Object.values(rawPermissions).flat();
          }
        }
        // If it's a verified non-anonymous session reference or key
        const userRec = await db.query.users.findFirst({
          where: eq(users.id, verified.key.referenceId),
        });
        if (userRec) {
          isAnonymous = Boolean(userRec.isAnonymous);
        }
      }
    } catch {}
  } else {
    // Otherwise try standard session via Better Auth
    try {
      const session = await auth.api.getSession({ headers: request.headers });
      if (session?.user) {
        userId = session.user.id;
        isAnonymous = Boolean(session.user.isAnonymous);
      }
    } catch {}
  }

  // Determine permission level
  let permissionLevel: WritePermissionLevel = "none";
  if (userId) {
    if (isAnonymous) {
      permissionLevel = "anonymous";
    } else {
      permissionLevel = "authenticated";
    }
  }

  return {
    userId,
    isAnonymous,
    permissionLevel,
    permissions: permissionList,
  };
}

/**
 * Return allowed task types based on account's write permission level.
 * - anonymous / plugin: can fulfill stem_request, embedding_request, options_request
 * - authenticated: can fulfill all task types (including answer_request/overwrites)
 * - none: cannot update any tasks (empty list)
 */
export function getAllowedTaskTypesForLevel(level: WritePermissionLevel): TaskType[] {
  switch (level) {
    case "admin":
    case "authenticated":
      return ["stem_request", "embedding_request", "options_request", "answer_request"];
    case "anonymous":
      return ["stem_request", "embedding_request", "options_request"];
    case "none":
    default:
      return [];
  }
}

export interface AutoTaskItem {
  taskId: string;
  taskType: TaskType;
  questionId: number;
  uoocQuestionId: string | null;
  type: string;
  tid: string;
  taskName: string | null;
  cid: string | null;
  courseName: string | null;
  stemPreview?: string | null;
  description: string;
}

/**
 * Fetch automatic tasks based on missing data in database, filtered by allowed task types.
 */
export async function getMissingDataTasks(options: {
  allowedTypes: TaskType[];
  typeFilter?: string;
  taskTypes?: TaskType[];
  cid?: string;
  tid?: string;
  questionIds?: string[];
  limit?: number;
}): Promise<AutoTaskItem[]> {
  const { allowedTypes, typeFilter, taskTypes, cid, tid, questionIds, limit = 50 } = options;
  if (allowedTypes.length === 0) {
    return [];
  }

  // If questionIds filter was explicitly provided as an empty array, no matching questions exist
  if (questionIds && questionIds.length === 0) {
    return [];
  }

  let tasksToQuery: TaskType[] = allowedTypes;
  if (taskTypes && taskTypes.length > 0) {
    tasksToQuery = allowedTypes.filter((t) => taskTypes.includes(t));
  } else if (typeFilter && typeFilter !== "all") {
    tasksToQuery = allowedTypes.filter((t) => t === typeFilter);
  }

  if (tasksToQuery.length === 0) {
    return [];
  }

  const results: AutoTaskItem[] = [];

  // Common scope conditions helper
  const buildScopeConditions = () => {
    const conditions = [];
    if (cid) conditions.push(eq(taskGroups.cid, cid));
    if (tid) conditions.push(eq(questions.tid, tid));
    if (questionIds && questionIds.length > 0) {
      conditions.push(inArray(questions.questionId, questionIds));
    }
    return conditions;
  };

  // 1. Missing stem: stem IS NULL OR stem = ''
  if (tasksToQuery.includes("stem_request") && results.length < limit) {
    const stemConditions = [
      or(isNull(questions.stem), eq(questions.stem, "")),
      ...buildScopeConditions(),
    ];

    const missingStemQuestions = await db
      .select({
        id: questions.id,
        questionId: questions.questionId,
        type: questions.type,
        tid: questions.tid,
        taskName: taskGroups.name,
        cid: taskGroups.cid,
        courseName: courses.name,
      })
      .from(questions)
      .innerJoin(taskGroups, eq(questions.tid, taskGroups.tid))
      .leftJoin(courses, eq(taskGroups.cid, courses.cid))
      .where(and(...stemConditions))
      .limit(limit - results.length);

    for (const q of missingStemQuestions) {
      results.push({
        taskId: `stem_${q.id}`,
        taskType: "stem_request",
        questionId: q.id,
        uoocQuestionId: q.questionId,
        type: q.type,
        tid: q.tid,
        taskName: q.taskName,
        cid: q.cid,
        courseName: q.courseName,
        description: "题目缺失题干文本内容，需补充题干",
      });
    }
  }

  // 2. Missing stem embedding: stem IS NOT NULL AND stem != '' AND stem_embedding IS NULL
  if (tasksToQuery.includes("embedding_request") && results.length < limit) {
    const embConditions = [
      sql`${questions.stem} IS NOT NULL AND ${questions.stem} != ''`,
      isNull(questions.stemEmbedding),
      ...buildScopeConditions(),
    ];

    const missingEmbQuestions = await db
      .select({
        id: questions.id,
        questionId: questions.questionId,
        type: questions.type,
        stem: questions.stem,
        tid: questions.tid,
        taskName: taskGroups.name,
        cid: taskGroups.cid,
        courseName: courses.name,
      })
      .from(questions)
      .innerJoin(taskGroups, eq(questions.tid, taskGroups.tid))
      .leftJoin(courses, eq(taskGroups.cid, courses.cid))
      .where(and(...embConditions))
      .limit(limit - results.length);

    for (const q of missingEmbQuestions) {
      results.push({
        taskId: `emb_${q.id}`,
        taskType: "embedding_request",
        questionId: q.id,
        uoocQuestionId: q.questionId,
        type: q.type,
        tid: q.tid,
        taskName: q.taskName,
        cid: q.cid,
        courseName: q.courseName,
        stemPreview: q.stem ? q.stem.slice(0, 80) : null,
        description: "题目已有题干但未计算向量嵌入，需计算并写入向量",
      });
    }
  }

  // 3. Missing options: type IN ('single', 'multiple', 'judge') AND options IS NULL
  if (tasksToQuery.includes("options_request") && results.length < limit) {
    const optConditions = [
      sql`${questions.type} IN ('single', 'multiple', 'judge')`,
      isNull(questions.options),
      ...buildScopeConditions(),
    ];

    const missingOptQuestions = await db
      .select({
        id: questions.id,
        questionId: questions.questionId,
        type: questions.type,
        stem: questions.stem,
        tid: questions.tid,
        taskName: taskGroups.name,
        cid: taskGroups.cid,
        courseName: courses.name,
      })
      .from(questions)
      .innerJoin(taskGroups, eq(questions.tid, taskGroups.tid))
      .leftJoin(courses, eq(taskGroups.cid, courses.cid))
      .where(and(...optConditions))
      .limit(limit - results.length);

    for (const q of missingOptQuestions) {
      results.push({
        taskId: `opt_${q.id}`,
        taskType: "options_request",
        questionId: q.id,
        uoocQuestionId: q.questionId,
        type: q.type,
        tid: q.tid,
        taskName: q.taskName,
        cid: q.cid,
        courseName: q.courseName,
        stemPreview: q.stem ? q.stem.slice(0, 80) : null,
        description: "选择/判断题目缺失选项列表，需补充选项",
      });
    }
  }

  // 4. Missing correct answer: no answer with isCorrect = true exists
  if (tasksToQuery.includes("answer_request") && results.length < limit) {
    const ansConditions = [
      sql`NOT EXISTS (
        SELECT 1 FROM ${answers}
        WHERE ${answers.questionId} = ${questions.id} AND ${answers.isCorrect} = true
      )`,
      ...buildScopeConditions(),
    ];

    const missingAnsQuestions = await db
      .select({
        id: questions.id,
        questionId: questions.questionId,
        type: questions.type,
        stem: questions.stem,
        tid: questions.tid,
        taskName: taskGroups.name,
        cid: taskGroups.cid,
        courseName: courses.name,
      })
      .from(questions)
      .innerJoin(taskGroups, eq(questions.tid, taskGroups.tid))
      .leftJoin(courses, eq(taskGroups.cid, courses.cid))
      .where(and(...ansConditions))
      .limit(limit - results.length);

    for (const q of missingAnsQuestions) {
      results.push({
        taskId: `ans_${q.id}`,
        taskType: "answer_request",
        questionId: q.id,
        uoocQuestionId: q.questionId,
        type: q.type,
        tid: q.tid,
        taskName: q.taskName,
        cid: q.cid,
        courseName: q.courseName,
        stemPreview: q.stem ? q.stem.slice(0, 80) : null,
        description: "题目尚未收录有效正确答案，需补充或验证正确答案",
      });
    }
  }

  return results;
}

export interface LocalQuestionRef {
  tid?: string;
  question_id: string;
}

export interface BankMatchOptions {
  cid?: string;
  tid?: string;
  localQuestionIds?: string[];
  items?: LocalQuestionRef[];
  taskTypes?: TaskType[];
  limit?: number;
  allowedTypes: TaskType[];
}

export interface MissingOnServerItem {
  cid?: string | null;
  tid?: string | null;
  questionId: string;
  description: string;
}

export interface BankMatchResult {
  scope: {
    cid?: string;
    tid?: string;
  };
  stats: {
    localCount: number;
    serverMatchedCount: number;
    missingOnServerCount: number;
    tasksCount: number;
  };
  missingOnServer: MissingOnServerItem[];
  matchedTasks: AutoTaskItem[];
  allowedTaskTypes: TaskType[];
}

/**
 * Match a locally maintained question ID table with the server database.
 * 1. Confirms whether the server is missing questions (local has questions not on server).
 * 2. Filters tasks for matched questions (scoped by cid / tid) according to allowed write permissions.
 */
export async function matchQuestionBank(options: BankMatchOptions): Promise<BankMatchResult> {
  const { cid, tid, localQuestionIds, items, taskTypes, limit = 50, allowedTypes } = options;

  // 1. Normalize local question entries
  const localEntries: Array<{ tid?: string; questionId: string }> = [];
  const seen = new Set<string>();

  if (localQuestionIds) {
    for (const qid of localQuestionIds) {
      const trimmed = qid?.trim();
      if (!trimmed) continue;
      const key = `${tid ?? ""}:${trimmed}`;
      if (!seen.has(key)) {
        seen.add(key);
        localEntries.push({ tid, questionId: trimmed });
      }
    }
  }

  if (items) {
    for (const item of items) {
      const qid = item.question_id?.trim();
      if (!qid) continue;
      const itemTid = item.tid ?? tid;
      const key = `${itemTid ?? ""}:${qid}`;
      if (!seen.has(key)) {
        seen.add(key);
        localEntries.push({ tid: itemTid, questionId: qid });
      }
    }
  }

  // 2. Query server questions within scope (cid / tid and questionIds if present)
  const uniqueQids = Array.from(new Set(localEntries.map((e) => e.questionId)));

  const scopeConditions = [];
  if (cid) scopeConditions.push(eq(taskGroups.cid, cid));
  if (tid) scopeConditions.push(eq(questions.tid, tid));
  if (uniqueQids.length > 0) {
    scopeConditions.push(inArray(questions.questionId, uniqueQids));
  }

  const serverQuestions =
    scopeConditions.length > 0 || localEntries.length === 0
      ? await db
          .select({
            id: questions.id,
            questionId: questions.questionId,
            tid: questions.tid,
            cid: taskGroups.cid,
          })
          .from(questions)
          .innerJoin(taskGroups, eq(questions.tid, taskGroups.tid))
          .where(scopeConditions.length > 0 ? and(...scopeConditions) : undefined)
      : [];

  // Build lookup index for server questions
  const serverTidQidSet = new Set(
    serverQuestions.filter((sq) => sq.questionId).map((sq) => `${sq.tid}:${sq.questionId}`),
  );
  const serverQidSet = new Set(
    serverQuestions.filter((sq) => sq.questionId).map((sq) => sq.questionId as string),
  );

  const matchedServerQuestionIds = new Set<string>();
  const missingOnServer: MissingOnServerItem[] = [];

  for (const entry of localEntries) {
    const exists = entry.tid
      ? serverTidQidSet.has(`${entry.tid}:${entry.questionId}`)
      : serverQidSet.has(entry.questionId);

    if (exists) {
      matchedServerQuestionIds.add(entry.questionId);
    } else {
      missingOnServer.push({
        cid: cid ?? null,
        tid: entry.tid ?? tid ?? null,
        questionId: entry.questionId,
        description: "本地题库中存在但服务端尚未收录此题目，建议调用 /api/upload/batch 上传录入",
      });
    }
  }

  // 3. Filter pending tasks for matched questions (or scoped cid/tid if no local entries were sent)
  const matchedTasks = await getMissingDataTasks({
    allowedTypes,
    taskTypes,
    cid,
    tid,
    questionIds: localEntries.length > 0 ? Array.from(matchedServerQuestionIds) : undefined,
    limit,
  });

  return {
    scope: {
      cid,
      tid,
    },
    stats: {
      localCount: localEntries.length,
      serverMatchedCount: matchedServerQuestionIds.size,
      missingOnServerCount: missingOnServer.length,
      tasksCount: matchedTasks.length,
    },
    missingOnServer,
    matchedTasks,
    allowedTaskTypes: allowedTypes,
  };
}
