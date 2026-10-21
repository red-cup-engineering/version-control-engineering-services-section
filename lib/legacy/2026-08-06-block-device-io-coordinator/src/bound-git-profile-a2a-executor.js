#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  agentRmnMessage,
  extractRmnPart,
  parseA2aMessage,
} from "@red-cup-engineering/a2a-rmn-part-service";
import { handleProductionProfileCarrier } from "./bound-git-profile.js";

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required for activated coordinator ingress`);
  }
  return value;
}

export async function executeBoundGitProfileA2aMessage(source, {
  environment = process.env,
  handle = handleProductionProfileCarrier,
} = {}) {
  const message = parseA2aMessage(
    typeof source === "string" || Buffer.isBuffer(source)
      ? JSON.parse(Buffer.from(source).toString("utf8"))
      : source,
  );
  const { bytes } = extractRmnPart(message.parts);
  const inputJws = message.metadata?.boundGitProfileAuthorization?.inputJws;
  if (!inputJws) throw new Error("signed Git profile authorization is required");
  const signed = await handle(bytes, {
    routesFile: required(environment, "BOUND_GIT_COORDINATOR_ROUTES"),
    inputJws,
    privateKeyPem: readFileSync(
      resolve(required(environment, "BOUND_GIT_COORDINATOR_SIGNING_KEY")),
      "utf8",
    ),
    signingKid: required(environment, "BOUND_GIT_COORDINATOR_SIGNING_KID"),
    signingJwks: required(environment, "BOUND_GIT_COORDINATOR_SIGNING_JWKS"),
    descriptor: JSON.parse(
      readFileSync(
        resolve(required(environment, "BOUND_GIT_COORDINATOR_DESCRIPTOR")),
        "utf8",
      ),
    ),
    dataRoot: required(environment, "BOUND_GIT_COORDINATOR_DATA_ROOT"),
  });
  const response = agentRmnMessage(signed.bytes);
  response.metadata = {
    ...response.metadata,
    jws: signed.jws,
    ...(signed.deviceReceipt === undefined
      ? {}
      : {
          deviceReceiptJws: signed.deviceReceiptJws,
          profileEvidence: signed.profileEvidence,
          profileEvidenceJws: signed.profileEvidenceJws,
        }),
  };
  return response;
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(
    `${JSON.stringify(await executeBoundGitProfileA2aMessage(await readStandardInput()))}\n`,
  );
}
