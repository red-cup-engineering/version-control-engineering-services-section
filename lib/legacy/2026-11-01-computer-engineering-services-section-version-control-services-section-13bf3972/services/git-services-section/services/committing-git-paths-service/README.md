# committing-git-paths-service

Stages and commits only explicitly named paths in a Git repository, refusing
to run if anything else is already staged.

## Install

```sh
npm install
```

## Usage

As a CLI:

```sh
commit-git-paths --repository /path/to/repo --path src/foo.js --path src/bar.js --message "Update foo and bar"
```

Options:

- `--repository <path>` — repository to operate in (default: current directory)
- `--path <path>` — a path to stage and commit; repeatable, at least one required
- `--message <message>` — commit message (required)
- `--dry-run` — print the resolved plan without staging or committing
- `--git-bin <path>` — path to the `git` binary (default: `/usr/bin/git`)
- `--exact-files` — opt into isolated-index exact-file commits. This refuses configured hooks and commit signing, commits only complete named file endpoints, and refuses to move the ref if `HEAD` advanced.

For a shared repository checkpoint, use exact-file mode:

```sh
commit-git-paths --repository /path/to/repo --path src/foo.js --message "Update foo" --exact-files
```

When another commit advances `HEAD` after the candidate is built, the command
returns `committed: false`, `reason: "head-advanced"`, `candidate`, and
`witnessRef`. The witness ref retains the candidate for recovery; the branch
remains at the other commit. After a successful install, exact-file mode reconciles only
the selected endpoints to the installed candidate; every outside staged tuple remains
untouched, and selected endpoints do not remain staged against the old tree. It rejects directories,
nested repository endpoints, and nonexistent untracked paths. Literal names,
including names that resemble Git pathspec magic, are handled as literal file
endpoints. A selected symlink file is committed as link bytes; paths through
symlink directories and `.git` metadata paths are refused.

Exact-file mode uses `commit-tree` and `update-ref` plumbing. It runs an
executable `post-commit` hook after ref and index installation and reports its
outcome in `postCommit`; a hook failure leaves the installed commit intact.
It refuses configured `pre-commit`, `prepare-commit-msg`, and `commit-msg`
hooks plus `commit.gpgSign=true`, because those policies cannot be safely
honored by an isolated candidate.

Exact-file mode rejects `--dry-run`: use the legacy API's dry run for a plan.
It also refuses installation if a selected worktree endpoint changes after the
candidate snapshot and before the ref compare-and-swap.

As a library:

```js
import { commitGitPaths } from "@red-cup-engineering/committing-git-paths-service";

const result = commitGitPaths({
  repository: "/path/to/repo",
  paths: ["src/foo.js", "src/bar.js"],
  message: "Update foo and bar",
});
```

`commitGitPaths({ repository, paths, message, dryRun, gitBin })` resolves the
repository root, verifies nothing outside the requested paths is already
staged, stages exactly those paths, and commits them. It throws if the index
already has unrelated staged changes, so a run never sweeps up someone else's
in-progress work. Returns a plan object; when not a dry run it also includes
`committed`, `head`, and `committedPaths` (or `reason: "nothing-staged"` if
the requested paths had no changes).

`commitGitExactFiles({ repository, paths, message, gitBin })` is the opt-in
library equivalent of `--exact-files`. It does not support `dryRun`; callers
that need a plan should use `commitGitPaths` with `dryRun: true`.

## Test

```sh
npm test
```
