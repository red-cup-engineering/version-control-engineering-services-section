# Git services

## Focused services

- `services/observing-git-repository-service/scripts/observe-git-repository.mjs`
  reports a repository's root, branch, HEAD, and status.
- `services/finding-parent-git-repositories-service/scripts/find-parent-git-repositories.mjs`
  verifies the containing repository and each parent submodule boundary.
- `services/committing-git-paths-service/scripts/commit-git-paths.mjs` stages and
  commits only explicitly named paths.
- `services/gitmodules-file-codec-service/scripts/read-gitmodules.mjs` reads a
  `.gitmodules` file as JSON.
- `services/pushing-current-branch-service/scripts/push-current-branch.mjs`
  publishes the current branch.

## Archive discovery

`scripts/archive-discovery --root PATH` emits a JSON inventory of every real
directory below the explicit root named exactly `archive` or `_archive`.
Pass `--format ndjson` when a line-oriented pipeline is more useful. The walk
does not follow symlinks. Directories beneath `.git` (or an explicit Git
directory root) remain in the inventory with `classification: "git-metadata"`;
they are never silently excluded.

```sh
node scripts/archive-discovery --root /path/to/tree --format ndjson
```

`scripts/archive-worktree-map --root PATH` composes with the same inventory
and adds the nearest enclosing Git worktree plus a fact-only legacy state:
`inside-legacy`, `outside-legacy`, `no-worktree`, or `git-metadata`. It does
not guess which living service should receive a corpus.

`scripts/audit-git-submodule-graph.mjs --repository PATH` compares the index's
real `160000` gitlinks with `.gitmodules` declarations and reports both
mismatch directions as JSON. It is read-only.

`scripts/audit-git-custody.mjs --repository PATH` walks the complete registered
submodule graph and the enclosing filesystem. It rejects dirty or uninitialized
descendants, unreachable pins, `refs/replace`, graph mismatches, and
unregistered nested worktrees; it reports duplicate origins, extra local
branches, and empty payload heads. Managed pushes run the same tracked hook
from `hooks/pre-push`, so a fresh clone does not depend on user Git config.

In pre-push mode, a commit deleting at least 20 paths and half of its parent
tree must carry a `Git-Custody-Relocation: path/to/receipt.json` trailer. The
tracked JSON receipt identifies both repository/path/tree endpoints and the
exact-tree or blob-set proof.

## Relocation

All relocation commands use explicit paths, conventional exit status, JSON on
stdout, and diagnostics on stderr. They are dry-run by default; `--apply` is
the only flag that mutates files. None of them commits or pushes.

```sh
# A registered Git submodule. The exact source pin is retained at the target.
scripts/relocate-a-git-repository.mjs \
  --source-repository /parent/with/source --source-path lib/the-repository \
  --destination-repository /parent/with/destination --destination-path apps/the-repository \
  --apply

# A specialization for a supplied legacy repository. It creates the dated
# child path YYYY-MM-DD-name, but does not create a remote or legacy parent.
scripts/retire-a-git-repository-to-legacy.mjs \
  --source-repository /active-parent --source-path services/retired \
  --legacy-repository /existing/legacy-repository --date 2026-08-03 --name retired \
  --apply

# Adopt an already-clean worktree as a submodule without changing its pin.
# Omit --apply to inspect the exact URL and commit first.
scripts/register-existing-git-repository.mjs \
  --parent /parent/worktree --path services/existing-child --apply
```

The Git relocation command refuses dirty parent worktrees, a source that is
not both a `.gitmodules` declaration and an index gitlink, or an occupied
destination. It invokes `scripts/git-services` by default, so its Git writes
use the section's serialized machine policy. `GIT_SERVICES_BIN` lets another
environment supply an equivalent Git command.
