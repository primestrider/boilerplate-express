/**
 * Turns this boilerplate into your own project. Run it once, after cloning:
 *
 *   npm run init-project -- <name> [--description "..."] [--reset-git]
 *
 * - deletes the learning guide (learn/)
 * - renames "boilerplate-express" everywhere (package, logs, API docs, CI,
 *   README, mail sender) and resets the package version and author
 * - with --reset-git, replaces the boilerplate's git history with a single
 *   initial commit (cannot be undone)
 * - deletes this script and the README section about it
 *
 * Every change is prepared before anything is written, and the script refuses
 * to run on uncommitted changes, so without --reset-git
 * `git checkout . && git clean -fd` undoes it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as prettier from "prettier";

const OLD_NAME = "boilerplate-express";
const ROOT = path.resolve(__dirname, "../..");
const USAGE =
  'Usage: npm run init-project -- <name> [--description "..."] [--reset-git]';

/** Lowercase only: the name is also a Docker image tag and a log field. */
const isValidName = (name: string) =>
  /^[a-z0-9][a-z0-9._-]*$/.test(name) && name.length <= 214;

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

/** Returns a git config value, or undefined when it is not set. */
const gitConfig = (...args: string[]) => {
  try {
    return git("config", ...args) || undefined;
  } catch {
    return undefined;
  }
};

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** Replaces `from` in a file's content, failing if it is not there. */
const replace = (content: string, file: string, from: string, to: string) => {
  if (!content.includes(from)) {
    throw new Error(`Expected "${from}" in ${file}; was it already changed?`);
  }
  return content.split(from).join(to);
};

const main = async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      description: { type: "string", default: "" },
      "reset-git": { type: "boolean", default: false },
    },
  });
  const [name] = positionals;

  if (!name || positionals.length > 1) {
    console.error(USAGE);
    return 1;
  }
  if (!isValidName(name)) {
    console.error(
      `Invalid name "${name}": use lowercase letters, digits, ".", "_" and "-".`,
    );
    return 1;
  }

  const isGitRepo = existsSync(path.join(ROOT, ".git"));
  if (isGitRepo && git("status", "--porcelain") !== "") {
    console.error("Commit or stash your changes first, so this can be undone.");
    return 1;
  }

  const description = values.description.trim();
  const userName = gitConfig("user.name");
  const userEmail = gitConfig("user.email");
  const author =
    userName && userEmail ? `${userName} <${userEmail}>` : (userName ?? "");
  const mailFrom = `${name} <no-reply@example.com>`;

  // Prepare every file first: a missing string aborts before any write.
  const files = new Map<string, string>();
  const edit = (file: string, change: (content: string) => string) =>
    files.set(file, change(files.get(file) ?? read(file)));

  edit("package.json", (content) => {
    const pkg = JSON.parse(content);
    delete pkg.scripts["init-project"];
    return JSON.stringify({
      ...pkg,
      name,
      version: "0.1.0",
      description,
      author,
    });
  });

  edit("package-lock.json", (content) => {
    const lock = JSON.parse(content);
    for (const entry of [lock, lock.packages[""]]) {
      entry.name = name;
      entry.version = "0.1.0";
    }
    return JSON.stringify(lock, null, 2) + "\n";
  });

  edit("tsconfig.build.json", (content) => {
    const config = JSON.parse(content);
    config.exclude = config.exclude.filter(
      (entry: string) => entry !== "src/cli/init-project.ts",
    );
    return JSON.stringify(config);
  });

  edit("README.md", (content) => {
    const start = content.indexOf("## Starting a New Project\n");
    const end = content.indexOf("## Prerequisites\n");
    if (start === -1 || end < start) {
      throw new Error("Expected the 'Starting a New Project' README section");
    }
    let readme = content.slice(0, start) + content.slice(end);
    readme = replace(readme, "README.md", `# ${OLD_NAME}\n`, `# ${name}\n`);
    readme = replace(
      readme,
      "README.md",
      "REST API boilerplate built with",
      `${description ? `${description}\n\n` : ""}REST API built with`,
    );
    return replace(
      readme,
      "README.md",
      "Boilerplate <no-reply@example.com>",
      mailFrom,
    );
  });

  for (const file of [
    "src/config/logger.ts",
    "src/docs/openapi.ts",
    ".github/workflows/ci.yml",
  ]) {
    edit(file, (content) => replace(content, file, OLD_NAME, name));
  }

  for (const file of ["src/config/env.ts", ".env.example"]) {
    edit(file, (content) =>
      replace(content, file, "Boilerplate <no-reply@example.com>", mailFrom),
    );
  }

  for (const [file, content] of files) {
    const filepath = path.join(ROOT, file);
    const { inferredParser } = await prettier.getFileInfo(filepath);
    if (!inferredParser) continue; // e.g. .env.example

    const options = await prettier.resolveConfig(filepath);
    files.set(file, await prettier.format(content, { ...options, filepath }));
  }

  for (const [file, content] of files) {
    writeFileSync(path.join(ROOT, file), content);
    console.log(`updated  ${file}`);
  }

  rmSync(path.join(ROOT, "learn"), { recursive: true, force: true });
  console.log("deleted  learn/");
  rmSync(__filename);
  console.log(`deleted  ${path.relative(ROOT, __filename)}`);

  if (values["reset-git"]) {
    // A repo-level identity would be lost with .git; carry it over.
    const localName = isGitRepo ? gitConfig("--local", "user.name") : undefined;
    const localEmail = isGitRepo
      ? gitConfig("--local", "user.email")
      : undefined;

    rmSync(path.join(ROOT, ".git"), { recursive: true, force: true });
    git("init", "--initial-branch=main");
    if (localName) git("config", "user.name", localName);
    if (localEmail) git("config", "user.email", localEmail);
    git("add", "--all");

    try {
      git("commit", "--message", `chore: start ${name} from ${OLD_NAME}`);
      console.log("git      new repository with one initial commit");
    } catch {
      console.error(
        'git      repository created, but the commit failed: set user.name/user.email and run `git commit -m "chore: initial commit"`',
      );
      return 1;
    }
  }

  console.log(`\n${name} is ready. Next: cp .env.example .env (see README).`);
  return 0;
};

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
