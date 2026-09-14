import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const roots = ["contracts", "packages", "services", "frontend/src", "frontend/public", "scripts"];
const extra = [
  "package.json", "package-lock.json", "frontend/index.html", "frontend/package.json", "frontend/package-lock.json",
  "requirements-dev.txt", "pyproject.toml", "foundry.toml", "gltest.config.yaml", ".dockerignore", "Dockerfile", "compose.yaml",
  "deploy/Caddyfile", "deploy/backup-now.sh", "deploy/restore-test.sh", "deploy/arena-backup.service",
  "deploy/arena-backup.timer", "deploy/arena-keep-awake.service",
];

function releaseFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        if (name !== "__pycache__") walk(path);
      } else if (!name.endsWith(".pyc")) {
        files.push(path);
      }
    }
  };
  for (const directory of roots) walk(join(root, directory));
  files.push(...extra.map((path) => join(root, path)));
  return files;
}

test("local release-candidate manifest matches the complete implementation bundle", () => {
  const manifest = JSON.parse(readFileSync(join(root, "docs/LOCAL-RELEASE-CANDIDATE.json"), "utf8"));
  const rows = releaseFiles().map((path) => [relative(root, path).replaceAll("\\", "/"), createHash("sha256").update(readFileSync(path)).digest("hex")] as const).sort((a, b) => a[0].localeCompare(b[0]));
  const heroFrames = rows.filter(([path]) => path.startsWith("frontend/public/hero-sequence/frame-") && path.endsWith(".webp"));
  assert.deepEqual(
    heroFrames.map(([path]) => path),
    Array.from({ length: 97 }, (_, index) => `frontend/public/hero-sequence/frame-${String(index + 1).padStart(3, "0")}.webp`),
  );
  const bundle = createHash("sha256");
  for (const [path, digest] of rows) bundle.update(`${path}\0${digest}\n`);
  assert.equal(manifest.schema, "arena-local-release-candidate-v1");
  assert.equal(manifest.fileCount, rows.length);
  assert.equal(manifest.sourceBundleSha256, bundle.digest("hex"));
  for (const [path, digest] of Object.entries(manifest.criticalFiles)) {
    assert.equal(rows.find(([candidate]) => candidate === path)?.[1], digest, `critical digest mismatch: ${path}`);
  }
});
