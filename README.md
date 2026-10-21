# Version Control Services Section

This section contains services and small utilities for ordinary Git repository
and forge operations.

## Git services

`git-services-section` uses `/usr/bin/git` directly. Its utilities observe
repositories, parse `.gitmodules`, inspect gitlinks, commit named paths, push
with `--recurse-submodules=check`, and perform explicit submodule maintenance.

It does not replace Git, inject hooks, maintain command allowlists, serialize all
Git operations, or install configuration in a user account.

## Repository layout

Submodules follow Git's standard model: the child repository owns its history,
and the parent records an exact child commit as a gitlink. Publish a child commit
before publishing a parent that points to it. Use recursive clone/update when a
complete checkout is required.

Git forge integrations live under the Git forge services subtree. Historical
experiments remain under dated legacy directories and are not active tooling.
