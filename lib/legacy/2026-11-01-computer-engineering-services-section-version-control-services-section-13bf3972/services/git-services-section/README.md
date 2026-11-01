# Git services

Small utilities built on standard Git commands.

## Repository operations

- `observe-git-repository` reports a repository's root, branch, HEAD, and status.
- `repository-restore-observation-service` verifies that explicitly selected
  Git-tracked files can be materialized and checked from a fresh temporary
  repository without presenting that bounded result as a full backup restore.
- `find-parent-git-repositories` identifies containing superprojects.
- `commit-git-paths` commits explicitly named paths.
- `push-current-branch` pushes with `--recurse-submodules=check`.
- `read-gitmodules` parses standard `.gitmodules` fields.
- `audit-git-submodule-graph.mjs` compares `.gitmodules` declarations with index
  gitlinks.

## Submodule maintenance

- `register-existing-git-repository.mjs` registers a clean repository as a
  submodule.
- `plan-directory-relocation` classifies both paths from Git facts and selects
  the standard relocation route without modifying either location.

The repository-scoped `relocate-directory` Codex skill defines the complete
destination-first transaction. This package intentionally does not provide a
generic mutator: the former source-first submodule mover could remove the source
before it had proved or published the destination.

These commands use `/usr/bin/git` directly. This package does not provide a Git
wrapper, custom hooks, machine configuration, branch policy, or credential
storage.

Use standard Git commands for ordinary work. For nested repositories, publish a
child commit before its parent gitlink and push parents with
`--recurse-submodules=check`.

Archive discovery and relocation planning remain read-only inventory utilities.
