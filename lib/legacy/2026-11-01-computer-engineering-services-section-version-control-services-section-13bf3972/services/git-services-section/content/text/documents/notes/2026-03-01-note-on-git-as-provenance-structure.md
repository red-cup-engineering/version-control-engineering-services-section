---
title: Git as Provenance Structure
description: "Git is a version control system. It is also, read differently, a provenance structure: an immutable record of what was done, when, by whom, and building on what prior work. This lesson reads git's data model through that lens, connecting its design to the formal concept of provenance in the [Interactive Semioverse](../../../../../../mathematics/objects/universes/interactive-semioverse/2026-06-17-emsemioverse-terms-index.md)."
aliases:
- Git as Provenance Structure
- git-as-provenance-structure
date-created: 2026-03-01 00:00:00
tags:
- version-control
- semiotics
requires:
- /technology/disciplines/computing/software/git/curricula/what-is-git.md
- "/technology/disciplines/computing/software/git/curricula/branching-and-merging.md"
teaches:
- Git as Provenance Structure
references:
  chacon_ProGit_2014:
    title: Git
    authors:
    - Chacon
    year: 2014
  spinellis_GitVersion_2012:
    title: Pro Git
    authors:
    - Spinellis
    year: 2012
---

Git is a version control system. It is also, read differently, a provenance structure: an
immutable record of what was done, when, by whom, and building on what prior work. This
lesson reads git's data model through that lens, connecting its design to the formal
concept of provenance in the [Interactive Semioverse](../../../../../../mathematics/objects/universes/interactive-semioverse/2026-06-17-emsemioverse-terms-index.md).

## Git's data model

Git stores four kinds of objects, all content-addressed (identified by cryptographic hash) [@chacon_ProGit_2014]:

- **Blob**: the contents of a single file at a single point in time.
- **Tree**: a directory listing — maps names to blobs or other trees.
- **Commit**: a snapshot of the entire repository (a tree), plus metadata: author, timestamp, message, and pointers to parent commits.
- **Tag**: a named reference to a specific commit.

Every commit points to one or more parent commits, forming a **directed acyclic graph (DAG)** [@spinellis_GitVersion_2012]. The DAG is append-only: you can add new commits, but existing commits are immutable. Their hashes depend on their content, their parents' hashes, and their metadata — change any of these and you get a different object.

## Commits as work units

A commit records a discrete unit of work: [the state](../../../../../../../../../../humanities/theories/sociology/theories/critical-theory/theories/anarchism/terms/the-state.md) of every file after the work, [the state](../../../../../../../../../../humanities/theories/sociology/theories/critical-theory/theories/anarchism/terms/the-state.md) before (via the parent commit), the identity of the author, and a natural-language description of what was done and why. This is a concrete instance of what the Interactive Semioverse formalizes as a **provenance history** — a finite sequence of construction steps, each recording what operation was applied, to what inputs, producing what result.

The parallel is direct:

| Git concept | Interactive Semioverse concept |
|-------------|-------------------------------|
| Commit | Construction step in a provenance history |
| Parent pointer | Dependency link between steps |
| Commit DAG | Provenance category (objects = histories, [morphisms](../../../../../../../../../../humanities/theories/math/theories/categories/theories/ordinary-categories/terms/morphism.md) = refinements) |
| Diff (parent → child) | The operation applied at that step |
| Author + timestamp | Agent and temporal metadata |
| Commit message | Natural-language annotation of the step |

A chain of commits from the initial commit to the current HEAD is a complete provenance history of the repository's current state. Every line of every file can be traced back through the DAG to the commit that introduced it (`git blame` does this mechanically).

## The DAG as provenance graph

The commit DAG is not a linear history — it branches and merges:

- **Branching** creates divergent lines of work from a common ancestor. Two agents (or the same agent pursuing two directions) produce independent sequences of commits. In the Interactive Semioverse, this corresponds to two interaction sequences operating on the same initial state, producing distinct [footprints](../../../../../../mathematics/objects/universes/interactive-semioverse/terms/footprint.md).

- **Merging** combines divergent lines into a single commit with multiple parents. The merge commit records the resolution: how two independent histories were reconciled into one state. This parallels the Interactive Semioverse's treatment of concurrent interactions — when two interaction sequences affect overlapping fragments, their results must be composed coherently.

- **Rebasing** rewrites history by replaying commits onto a different base. This produces new commits (with different hashes) that represent the same logical work in a different provenance context. The original commits remain in the object store until garbage-collected. The Interactive Semioverse's provenance categories have a similar structure: refinement [morphisms](../../../../../../../../../../humanities/theories/math/theories/categories/theories/ordinary-categories/terms/morphism.md) between histories that preserve the logical content while changing the construction path.

## Distributed repositories

Git is distributed: every clone is a complete copy of the repository, including the full commit DAG. Multiple agents maintain their own local histories and synchronize through push and pull operations that transfer commits between repositories.

This distribution has structural significance. Each local repository is a local view of a shared semioverse — a fragment with its own interaction history. Synchronization (push/pull/fetch) transfers provenance records between views, and merge resolution ensures coherence. There is no privileged central copy; any clone can reconstruct the full history.

In the Interactive Semioverse's terms, each local repository is an agent's working state, and synchronization operations are [interaction terms](../../../../../../mathematics/objects/universes/interactive-semioverse/terms/interaction-term.md) that transport fragments between agents while preserving provenance.

## Why provenance matters for knowledge work

Any collaborative knowledge project benefits from provenance — the ability to trace every change to who made it, when, and why. Git provides this without requiring infrastructure beyond the repository itself. The provenance is intrinsic: it is the data structure, not an annotation added afterward.

Properties that make git effective as a provenance system:

- **Immutability**: past commits cannot be silently altered. If someone force-pushes, the original commits still exist locally in every clone that fetched them. Provenance records are structurally durable.
- **Content addressing**: identical content produces identical hashes regardless of where or when it is created. Two people independently writing the same file get the same blob. This provides a natural notion of equality for content.
- **Branching as parallel exploration**: a contributor can branch to explore an idea without affecting the shared state. If the exploration succeeds, it merges; if it fails, the branch is abandoned. The exploration's history is preserved either way.
- **Merge as documented decision**: a merge commit records how two lines of work were reconciled. The merge itself is a provenance step — it documents a decision, not just a combination.

## Summary

Git is a provenance structure implemented as a content-addressed DAG of immutable snapshots. Its design choices — content addressing, immutable commits, directed acyclic history, distributed clones — make it well suited to any project where knowing the history of how knowledge was produced is as important as the knowledge itself.
