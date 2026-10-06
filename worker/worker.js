const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-6-luna";

const QUESTIONS = [
  "Why do you want to join?",
  "What do you bring to the room?",
  "What are you obsessed with right now?"
];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "*";

  let allowOrigin = "*";
  if (allowed !== "*") {
    allowOrigin = origin === allowed ? origin : allowed;
  } else if (origin) {
    allowOrigin = origin;
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function isAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${env.ADMIN_TOKEN}`;
}

function cleanAnswer(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 700);
}

function getOutputText(responseJson) {
  for (const item of responseJson.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

function parseDecision(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON returned by model.");

  const parsed = JSON.parse(match[0]);
  const decision = parsed.decision === "accept" ? "accept" : "reject";
  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
  const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 500) : "No reason supplied.";
  const authenticityConcern = parsed.authenticity_concern === true;
  return { decision, score, reason, authenticityConcern };
}

async function askOpenAI(answers, env) {
  const instructions = `
You are the admissions evaluator for Butterfly Club, a small weekly creative community.

Evaluate ONLY the substance of the applicant's three answers.

Rubric:
- Curiosity: 30 points
- Originality of thought: 30 points
- Potential contribution to the room: 25 points
- Specificity / genuine effort: 15 points

Butterfly Club is selective, but the AI is only a first-stage shortlisting assistant, not the final judge.
Default toward shortlisting sincere, thoughtful applicants.
Decision rule:
- Accept at 55/100 or above.
- For scores 45–54, accept if there is clear curiosity, sincerity, originality, or a concrete contribution.
- Reject below 45, or when the answers are clearly spam, trolling, empty, copied filler, generic one-liners, or show no sincere intent to participate.
Human review makes the final decision after shortlisting.

Authenticity check:
- Do NOT claim that you can reliably detect AI authorship.
- However, if the answers feel highly generic, templated, over-polished, impersonal, or contain broad claims without concrete personal detail, treat that as weak authenticity and specificity.
- If there are strong signs that the applicant did not answer in their own voice, set "authenticity_concern" to true.
- Do not set authenticity_concern merely because the English is grammatically strong or polished.

Important:
- Do not reward prestige, job title, wealth, education, fame, English fluency, or writing polish.
- Do not infer or use age, gender, nationality, ethnicity, religion, disability, politics, sexual orientation, health, or any other sensitive/personal characteristic.
- Do not reject someone merely for unconventional or strange interests; thoughtful weirdness is welcome.
- Judge curiosity, originality, contribution, and specificity only.
- Return JSON only. No markdown and no extra text.

Required JSON:
{"decision":"accept"|"reject","score":0-100,"reason":"one short internal sentence","authenticity_concern":true|false}
`.trim();

  const applicantText = QUESTIONS.map((q, i) => `${i + 1}. ${q}\nAnswer: ${answers[i]}`).join("\n\n");

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || DEFAULT_MODEL,
      store: false,
      max_output_tokens: 600,
      reasoning: { effort: "minimal" },
      text: {
        format: {
          type: "json_schema",
          name: "butterfly_club_evaluation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              decision: { type: "string", enum: ["accept", "reject"] },
              score: { type: "integer", minimum: 0, maximum: 100 },
              reason: { type: "string" },
              authenticity_concern: { type: "boolean" }
            },
            required: ["decision", "score", "reason", "authenticity_concern"]
          }
        }
      },
      instructions,
      input: applicantText,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || `OpenAI request failed (${response.status}).`;
    throw new Error(message);
  }
  const evaluation = parseDecision(getOutputText(data));

  if (evaluation.authenticityConcern && evaluation.score < 70) {
    evaluation.decision = "reject";
    evaluation.reason = "The answers felt too generic or templated to confidently reflect the applicant's own voice.";
  }

  return evaluation;
}

async function createApplication(env, answers, evaluation) {
  if (!env.DB) throw new Error("D1 database is not configured.");

  const token = crypto.randomUUID();
  const reviewStatus = evaluation.decision === "accept" ? "pending" : "not_applicable";

  const result = await env.DB.prepare(`
    INSERT INTO applications (
      status, review_status, score, ai_reason,
      answer_1, answer_2, answer_3,
      submission_token
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      evaluation.decision,
      reviewStatus,
      evaluation.score,
      evaluation.reason,
      answers[0],
      answers[1],
      answers[2],
      token
    )
    .run();

  return {
    applicationId: result.meta.last_row_id,
    submissionToken: evaluation.decision === "accept" ? token : null,
  };
}

async function updateContact(env, applicationId, token, name, phone) {
  if (!env.DB) throw new Error("D1 database is not configured.");

  const row = await env.DB.prepare(`
    SELECT id, status, submission_token
    FROM applications
    WHERE id = ?
    LIMIT 1
  `).bind(applicationId).first();

  if (!row || row.status !== "accept" || row.submission_token !== token) return false;

  await env.DB.prepare(`
    UPDATE applications
    SET name = ?, phone = ?, submitted_at = CURRENT_TIMESTAMP, submission_token = NULL
    WHERE id = ?
  `).bind(name.slice(0, 120), phone.slice(0, 200), applicationId).run();

  return true;
}

async function getAdminApplications(env, filter) {
  if (!env.DB) throw new Error("D1 database is not configured.");

  const whereMap = {
    pending: "status = 'accept' AND review_status = 'pending'",
    approved: "status = 'accept' AND review_status = 'approved'",
    rejected: "status = 'accept' AND review_status = 'rejected'",
    ai_rejected: "status = 'reject'",
    all: "1 = 1",
  };
  const where = whereMap[filter] || whereMap.pending;

  const apps = await env.DB.prepare(`
    SELECT
      id, created_at, submitted_at, status, review_status,
      score, ai_reason, answer_1, answer_2, answer_3,
      name, phone
    FROM applications
    WHERE ${where}
    ORDER BY COALESCE(submitted_at, created_at) DESC
    LIMIT 300
  `).all();

  const statsRows = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN status = 'accept' AND review_status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'accept' AND review_status = 'approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status = 'accept' AND review_status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status = 'reject' THEN 1 ELSE 0 END) AS ai_rejected,
      COUNT(*) AS total
    FROM applications
  `).first();

  return {
    applications: apps.results || [],
    stats: {
      pending: Number(statsRows?.pending || 0),
      approved: Number(statsRows?.approved || 0),
      rejected: Number(statsRows?.rejected || 0),
      aiRejected: Number(statsRows?.ai_rejected || 0),
      total: Number(statsRows?.total || 0),
    },
  };
}

async function updateReview(env, id, reviewStatus) {
  if (!env.DB) throw new Error("D1 database is not configured.");
  if (!["approved", "rejected", "pending"].includes(reviewStatus)) return false;

  const result = await env.DB.prepare(`
    UPDATE applications
    SET review_status = ?, reviewed_at = CASE WHEN ? = 'pending' THEN NULL ELSE CURRENT_TIMESTAMP END
    WHERE id = ? AND status = 'accept'
  `).bind(reviewStatus, reviewStatus, id).run();

  return Number(result.meta.changes || 0) > 0;
}

export default {
  async fetch(request, env) {
    const cors = getCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    try {
      if (request.method === "POST" && url.pathname === "/evaluate") {
        const body = await request.json().catch(() => ({}));
        const rawAnswers = Array.isArray(body.answers) ? body.answers : [];

        if (rawAnswers.length !== 3) return json({ error: "Exactly three answers are required." }, 400, cors);
        const answers = rawAnswers.map(cleanAnswer);
        if (answers.some(answer => answer.length < 3)) return json({ error: "Please answer all three questions." }, 400, cors);
        if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is not configured." }, 500, cors);

        const evaluation = await askOpenAI(answers, env);
        const stored = await createApplication(env, answers, evaluation);

        return json({
          decision: evaluation.decision,
          score: evaluation.score,
          authenticityConcern: evaluation.authenticityConcern,
          applicationId: stored.applicationId,
          submissionToken: stored.submissionToken,
        }, 200, cors);
      }

      if (request.method === "POST" && url.pathname === "/submit") {
        const body = await request.json().catch(() => ({}));
        const applicationId = Number(body.applicationId);
        const submissionToken = typeof body.submissionToken === "string" ? body.submissionToken : "";
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const phone = typeof body.phone === "string" ? body.phone.trim() : "";

        if (!Number.isFinite(applicationId) || !submissionToken || name.length < 2 || phone.length < 2 || phone.length > 200) {
          return json({ error: "Invalid submission." }, 400, cors);
        }

        const ok = await updateContact(env, applicationId, submissionToken, name, phone);
        if (!ok) return json({ error: "Application could not be verified." }, 403, cors);
        return json({ ok: true }, 200, cors);
      }

      if (url.pathname.startsWith("/admin/")) {
        if (!isAdmin(request, env)) return json({ error: "Unauthorized." }, 401, cors);

        if (request.method === "GET" && url.pathname === "/admin/applications") {
          const filter = url.searchParams.get("filter") || "pending";
          const result = await getAdminApplications(env, filter);
          return json(result, 200, cors);
        }

        const reviewMatch = url.pathname.match(/^\/admin\/applications\/(\d+)\/review$/);
        if (request.method === "POST" && reviewMatch) {
          const id = Number(reviewMatch[1]);
          const body = await request.json().catch(() => ({}));
          const reviewStatus = typeof body.reviewStatus === "string" ? body.reviewStatus : "";
          const ok = await updateReview(env, id, reviewStatus);
          if (!ok) return json({ error: "Application not found or invalid review state." }, 400, cors);
          return json({ ok: true }, 200, cors);
        }
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true }, 200, cors);
      }

      return json({ error: "Not found." }, 404, cors);
    } catch (error) {
      console.error(error);
      return json({ error: "Something went wrong. Please try again." }, 500, cors);
    }
  },
};
