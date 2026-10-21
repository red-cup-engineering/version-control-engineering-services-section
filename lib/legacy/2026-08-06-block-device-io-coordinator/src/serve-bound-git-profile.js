#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { serveContractedAgent } from "@red-cup-engineering/a2a-contracted-agent-service";

export function serveBoundGitProfile(options = {}) {
  return serveContractedAgent({
    ...options,
    executor: process.execPath,
    executorArgs: [fileURLToPath(new URL("./bound-git-profile-a2a-executor.js", import.meta.url))],
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await serveBoundGitProfile();
}
