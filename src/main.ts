import * as core from "@actions/core";
import * as github from "@actions/github";
import { scan, type Finding } from "./rules";

const MARKER = "<!-- simple-import-verify -->";
const NAME = "Simple Import Verify";

function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return [MARKER, `## ${NAME}`, "", "No issues found."].join("\n");
  }
  const rows = findings
    .map((f) => {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      return `| ${f.severity} | \`${f.ruleId}\` | ${loc} | ${f.title} |`;
    })
    .join("\n");
  return [
    MARKER,
    `## ${NAME}`,
    "",
    `Found **${findings.length}** issue(s).`,
    "",
    "| Severity | Rule | Location | Detail |",
    "| --- | --- | --- | --- |",
    rows,
  ].join("\n");
}

async function upsertPrComment(token: string, body: string): Promise<void> {
  const { context } = github;
  if (context.eventName !== "pull_request" && context.eventName !== "pull_request_target") {
    core.info("Not a pull_request event — skipping PR comment.");
    return;
  }
  const issue_number = context.payload.pull_request?.number;
  if (!issue_number) return;
  const octokit = github.getOctokit(token);
  const { data: comments } = await octokit.rest.issues.listComments({ ...context.repo, issue_number });
  const existing = comments.find((c) => c.body?.includes(MARKER));
  if (existing) {
    await octokit.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body });
    return;
  }
  await octokit.rest.issues.createComment({ ...context.repo, issue_number, body });
}

async function fetchPullDiff(token: string): Promise<string> {
  const { context } = github;
  const pr = context.payload.pull_request?.number;
  if (!pr) throw new Error("No pull request number in context. Run on pull_request.");
  const octokit = github.getOctokit(token);
  const res = await octokit.rest.pulls.get({
    ...context.repo,
    pull_number: pr,
    mediaType: { format: "diff" },
  });
  return typeof res.data === "string" ? res.data : String(res.data);
}

async function run(): Promise<void> {
  const token = core.getInput("github-token") || process.env.GITHUB_TOKEN || "";
  const failOn = (core.getInput("fail-on") || "none").toLowerCase();
  if (!token) {
    core.setFailed("github-token is required");
    return;
  }
  const diff = await fetchPullDiff(token);
  const findings = scan(diff);
  core.info(`Findings: ${findings.length}`);
  const summary = formatFindings(findings);
  await core.summary.addRaw(summary, true).write();
  for (const f of findings) {
    const msg = `${f.title} (${f.ruleId})`;
    if (f.severity === "high") core.error(msg, { file: f.file, startLine: f.line });
    else if (f.severity === "medium") core.warning(msg, { file: f.file, startLine: f.line });
    else core.notice(msg, { file: f.file, startLine: f.line });
  }
  try {
    await upsertPrComment(token, summary);
  } catch (err) {
    core.warning(`Could not post PR comment: ${err instanceof Error ? err.message : String(err)}`);
  }
  core.setOutput("finding-count", String(findings.length));
  const shouldFail =
    failOn === "high"
      ? findings.some((f) => f.severity === "high")
      : failOn === "medium"
        ? findings.some((f) => f.severity === "high" || f.severity === "medium")
        : false;
  if (shouldFail) core.setFailed(`simple-import-verify: ${findings.length} finding(s) (fail-on=${failOn})`);
  else core.info(`Done. ${findings.length} finding(s).`);
}

run().catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
