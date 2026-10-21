import { readFileSync } from "node:fs";
import {
  agentCardSignatureEvidence,
  discoverSignedAgentCard,
} from "@red-cup-engineering/a2a-agent-card-discovery-service";
import {
  decodeProtectedHeader,
  flattenedVerify,
  FlattenedSign,
  importJWK,
  importPKCS8,
} from "jose";
import { readProviderAllocation } from "./bound-git-profile-store.js";
import {
  decodeCarrier,
  validatePrivateIndexReleaseBinding,
} from "./bound-git-profile-wire.js";

export function readCoordinatorRoutes(path) {
  const source = JSON.parse(readFileSync(path, "utf8"));
  if (source?.version !== 1 || !Array.isArray(source.routes)) {
    throw new Error("actor-route-drift");
  }
  const routes = new Map();
  let prior = "";
  for (const route of source.routes) {
    if (
      !route ||
      Object.keys(route).sort().join() !== "account,actor,agentCardUrl" ||
      typeof route.actor !== "string" ||
      route.actor <= prior ||
      routes.has(route.actor) ||
      !/^https?:\/\//u.test(route.agentCardUrl) ||
      !(
        route.account === null ||
        /^eip155:31337:0x[0-9a-fA-F]{40}$/u.test(route.account)
      )
    ) {
      throw new Error("actor-route-drift");
    }
    prior = route.actor;
    routes.set(route.actor, Object.freeze({ ...route }));
  }
  return routes;
}

export async function verifyGitProfileCaller({
  routes,
  operation,
  bytes,
  jws,
  fetch: fetchImpl = globalThis.fetch,
  discover = discoverSignedAgentCard,
}) {
  const route = routes.get(operation.gitActor);
  if (!route || route.account !== operation.gitAccount) {
    throw new Error("actor-route-drift");
  }
  const card = await discover({
    agentUrl: route.agentCardUrl,
    fetch: fetchImpl,
    signal: new AbortController().signal,
  });
  const evidence = agentCardSignatureEvidence(card);
  if (
    operation.gitCardId !== evidence.card ||
    operation.gitCardSignatureId !== evidence.signature ||
    operation.gitKid !== evidence.kid ||
    operation.gitJwks !== evidence.jwks
  ) {
    throw new Error("actor-route-drift");
  }
  const header = decodeProtectedHeader(jws);
  if (
    Object.keys(header).sort().join() !== "alg,jku,kid,typ" ||
    header.typ !== "JOSE" ||
    header.kid !== evidence.kid ||
    header.alg !== evidence.algorithm ||
    header.jku !== evidence.jwks
  ) {
    throw new Error("actor-route-drift");
  }
  const response = await fetchImpl(evidence.jwks, {
    headers: { Accept: "application/jwk-set+json, application/json" },
    signal: new AbortController().signal,
  });
  if (!response.ok) throw new Error("jwks-unavailable");
  const jwks = await response.json();
  const matches = (jwks.keys ?? []).filter(
    (key) =>
      key.kid === header.kid &&
      key.alg === header.alg &&
      !Object.hasOwn(key, "d"),
  );
  if (matches.length !== 1) throw new Error("actor-route-drift");
  const verified = await flattenedVerify(
    {
      ...jws,
      payload: jws.payload ?? Buffer.from(bytes).toString("base64url"),
    },
    await importJWK(matches[0], header.alg),
  );
  if (!Buffer.from(verified.payload).equals(Buffer.from(bytes))) {
    throw new Error("binding-mismatch");
  }
}

async function discoverRouteEvidence({
  routes,
  actor,
  fetch: fetchImpl = globalThis.fetch,
  discover = discoverSignedAgentCard,
}) {
  const route = routes.get(actor);
  if (!route) throw new Error("actor-route-drift");
  const card = await discover({
    agentUrl: route.agentCardUrl,
    fetch: fetchImpl,
    signal: new AbortController().signal,
  });
  return Object.freeze({
    route,
    evidence: agentCardSignatureEvidence(card),
  });
}

function requireReceiverEvidence(binding, evidence) {
  if (
    binding.receiverCardId !== evidence.card ||
    binding.receiverCardSignatureId !== evidence.signature ||
    binding.receiverKid !== evidence.kid ||
    binding.receiverJwks !== evidence.jwks
  ) {
    throw new Error("actor-route-drift");
  }
}

async function verifyIncludedJws({
  bytes,
  jws,
  evidence,
  fetch: fetchImpl = globalThis.fetch,
}) {
  const header = decodeProtectedHeader(jws);
  if (
    Object.keys(header).sort().join() !== "alg,jku,kid,typ" ||
    header.typ !== "JOSE" ||
    header.kid !== evidence.kid ||
    header.alg !== evidence.algorithm ||
    header.jku !== evidence.jwks ||
    typeof jws.payload !== "string" ||
    !Buffer.from(jws.payload, "base64url").equals(Buffer.from(bytes))
  ) {
    throw new Error("actor-route-drift");
  }
  const response = await fetchImpl(evidence.jwks, {
    headers: { Accept: "application/jwk-set+json, application/json" },
    signal: new AbortController().signal,
  });
  if (!response.ok) throw new Error("jwks-unavailable");
  const jwks = await response.json();
  const matches = (jwks.keys ?? []).filter(
    (key) =>
      key.kid === header.kid &&
      key.alg === header.alg &&
      !Object.hasOwn(key, "d"),
  );
  if (matches.length !== 1) throw new Error("actor-route-drift");
  const verified = await flattenedVerify(jws, await importJWK(matches[0], header.alg));
  if (!Buffer.from(verified.payload).equals(Buffer.from(bytes))) {
    throw new Error("binding-mismatch");
  }
}

export async function verifyReceiverProfileEvidence({
  routes,
  operation,
  dataRoot,
  fetch,
  discover,
}) {
  if (operation.kind === "prepare-profile-operation") {
    const { evidence } = await discoverRouteEvidence({
      routes,
      actor: operation.receiverActor,
      fetch,
      discover,
    });
    requireReceiverEvidence(operation, evidence);
    return;
  }
  if (operation.kind !== "retire-profile-operation") return;
  const { allocation } = readProviderAllocation({
    root: dataRoot,
    allocationId: operation.allocationId,
  });
  const { result } = validatePrivateIndexReleaseBinding({
    operation,
    allocation,
  });
  const { evidence } = await discoverRouteEvidence({
    routes,
    actor: allocation.receiverActor,
    fetch,
    discover,
  });
  requireReceiverEvidence(allocation, evidence);
  if (
    result.receiverCardId !== evidence.card ||
    result.receiverCardSignatureId !== evidence.signature ||
    result.receiverKid !== evidence.kid ||
    result.receiverJwks !== evidence.jwks
  ) {
    throw new Error("actor-route-drift");
  }
  await verifyIncludedJws({
    bytes: operation.releaseResultBytes,
    jws: operation.releaseResultJws,
    evidence,
    fetch,
  });
  decodeCarrier("EvidenceResult", operation.releaseResultBytes);
}

export async function signProfileCarrier({
  bytes,
  privateKeyPem,
  kid,
  jwks,
}) {
  const key = await importPKCS8(privateKeyPem, "EdDSA");
  return new FlattenedSign(bytes)
    .setProtectedHeader({ alg: "EdDSA", kid, jku: jwks, typ: "JOSE" })
    .sign(key);
}

export function createCoordinatorProductionContext({
  routesFile,
  inputJws,
  privateKeyPem,
  signingKid,
  signingJwks,
  descriptor,
  dataRoot,
  fetch,
  discover,
}) {
  if (
    typeof routesFile !== "string" ||
    typeof inputJws !== "object" ||
    typeof privateKeyPem !== "string" ||
    typeof signingKid !== "string" ||
    typeof signingJwks !== "string"
  ) {
    throw new Error("coordinator-production-boundary-unavailable");
  }
  const routes = readCoordinatorRoutes(routesFile);
  return Object.freeze({
    descriptor,
    dataRoot,
    async authenticate(operation, bytes) {
      await verifyGitProfileCaller({
        routes,
        operation,
        bytes,
        jws: inputJws,
        fetch,
        discover,
      });
      await verifyReceiverProfileEvidence({
        routes,
        operation,
        dataRoot,
        fetch,
        discover,
      });
    },
    async signResult(bytes) {
      return signProfileCarrier({
        bytes,
        privateKeyPem,
        kid: signingKid,
        jwks: signingJwks,
      });
    },
  });
}
