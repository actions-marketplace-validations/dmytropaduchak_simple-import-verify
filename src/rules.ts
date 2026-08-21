import * as fs from "node:fs";
export type Severity = "high" | "medium" | "low";
export type Finding = {
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
  file: string;
  line?: number;
};

export function parseDiffHunks(diff: string): Array<{ file: string; line: number; text: string }> {
  const out: Array<{ file: string; line: number; text: string }> = [];
  let file = "unknown";
  let newLine = 0;
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++ b/")) {
      file = raw.slice(6).trim() || "unknown";
      continue;
    }
    if (raw.startsWith("@@")) {
      const m = raw.match(/\+(\d+)/);
      newLine = m ? Number(m[1]) : 0;
      continue;
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      out.push({ file, line: newLine, text: raw.slice(1) });
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-") && !raw.startsWith("---")) continue;
    if (!raw.startsWith("\\") && !raw.startsWith("diff ") && !raw.startsWith("index ")) newLine += 1;
  }
  return out;
}

export function changedFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    if (!line.startsWith("+++ b/")) continue;
    const file = line.slice(6).trim();
    if (file && file !== "/dev/null") files.add(file);
  }
  return [...files];
}


function loadDeps(): Set<string> {
  const deps = new Set<string>([
    "fs", "path", "os", "util", "crypto", "http", "https", "url", "stream", "events",
    "buffer", "child_process", "assert", "process",
  ]);
  if (fs.existsSync("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      for (const bag of [
        pkg.dependencies,
        pkg.devDependencies,
        pkg.peerDependencies,
        pkg.optionalDependencies,
      ]) {
        if (!bag) continue;
        for (const name of Object.keys(bag)) deps.add(name);
      }
    } catch {
      /* ignore */
    }
  }
  return deps;
}

function pkgName(spec: string): string | null {
  const s = spec.replace(/['"]/g, "").trim();
  if (!s || s.startsWith(".") || s.startsWith("/") || s.startsWith("node:")) return null;
  if (s.startsWith("@")) {
    const parts = s.split("/");
    return parts.length >= 2 ? parts[0] + "/" + parts[1] : null;
  }
  return s.split("/")[0] || null;
}

const IMPORT_RE = /(?:import\s+(?:[^'"]+\s+from\s+)?|require\s*\(\s*)['"]([^'"]+)['"]/g;

export function scan(diff: string): Finding[] {
  const deps = loadDeps();
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const row of parseDiffHunks(diff)) {
    if (!/\.(m?[jt]sx?|cjs|mjs)$/i.test(row.file)) continue;
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(row.text)) !== null) {
      const name = pkgName(m[1]);
      if (!name || deps.has(name)) continue;
      const key = row.file + ":" + name;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        ruleId: "unknown-import",
        severity: "medium",
        title: "Import not in package.json: " + name,
        detail: row.text.trim().slice(0, 120),
        file: row.file,
        line: row.line,
      });
    }
  }
  return findings;
}
