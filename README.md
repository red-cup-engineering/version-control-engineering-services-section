# Version Control Services Section

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

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
