import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { userRmnMessage } from "@red-cup-engineering/a2a-rmn-part-service";
import {
  agentCardSignatureEvidence,
  createAgentCardSigningConfiguration,
} from "@red-cup-engineering/a2a-agent-card-discovery-service";
import { exportJWK, generateKeyPair } from "jose";
import { executeBoundGitProfileA2aMessage } from "../src/bound-git-profile-a2a-executor.js";
import {
  readCoordinatorRoutes,
  verifyReceiverProfileEvidence,
} from "../src/bound-git-profile-auth.js";
import { fixtures } from "../src/bound-git-profile-wire.js";

test("A2A executor carries the Git signature into the production handler and returns the full evidence chain", async () => {
  const root = mkdtempSync(join(tmpdir(), "bound-git-profile-ingress-"));
  const environment = {
    BOUND_GIT_COORDINATOR_SIGNING_KID: "coordinator-key",
    BOUND_GIT_COORDINATOR_SIGNING_JWKS: "https://coordinator.invalid/jwks.json",
    BOUND_GIT_COORDINATOR_DATA_ROOT: join(root, "journal"),
  };
  for (const [name, value] of Object.entries({
    BOUND_GIT_COORDINATOR_ROUTES: "{}",
    BOUND_GIT_COORDINATOR_SIGNING_KEY: "private",
    BOUND_GIT_COORDINATOR_DESCRIPTOR: "{}",
  })) {
    const path = join(root, name);
    writeFileSync(path, value);
    environment[name] = path;
  }
  const inputJws = { protected: "in", signature: "sig" };
  const message = userRmnMessage(Buffer.from([1, 2, 3]));
  message.metadata.boundGitProfileAuthorization = { inputJws };
  let observed;
  const response = await executeBoundGitProfileA2aMessage(message, {
    environment,
    handle: async (bytes, configuration) => {
      observed = { bytes, configuration };
      return {
        bytes: Buffer.from([7]),
        jws: { protected: "receipt", signature: "sig" },
        deviceReceipt: { type: "DeviceReceipt" },
        deviceReceiptJws: { protected: "device", signature: "sig" },
        profileEvidence: { deviceReceipt: { type: "DeviceReceipt" } },
        profileEvidenceJws: { protected: "evidence", signature: "sig" },
      };
    },
  });
  assert.deepEqual(observed.bytes, Buffer.from([1, 2, 3]));
  assert.deepEqual(observed.configuration.inputJws, inputJws);
  assert.deepEqual(response.metadata.jws, { protected: "receipt", signature: "sig" });
  assert.deepEqual(response.metadata.deviceReceiptJws, { protected: "device", signature: "sig" });
  assert.equal(response.parts.length, 1);
  assert.equal(response.parts[0].mediaType, "application/rmn+cbor");
});

test("prepare readiness independently discovers the frozen receiver card", async () => {
  const root = mkdtempSync(join(tmpdir(), "bound-git-receiver-route-"));
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    extractable: true,
  });
  const baseUrl = "https://receiver.example.invalid";
  const kid = "receiver-fixture";
  const configuration = createAgentCardSigningConfiguration({
    baseUrl,
    kid,
    privateKey,
    publicJwk: await exportJWK(publicKey),
  });
  const card = {
    name: "receiver",
    description: "fixture",
    version: "1",
    protocolVersion: "1.0",
    preferredTransport: "JSONRPC",
    url: `${baseUrl}/a2a`,
    supportedInterfaces: [
      {
        url: `${baseUrl}/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
      extensions: [],
    },
    defaultInputModes: ["application/rmn+cbor"],
    defaultOutputModes: ["application/rmn+cbor"],
    skills: [],
  };
  const signed = await configuration.agentCardSignatureGenerator(card);
  const evidence = agentCardSignatureEvidence(signed);
  const operation = structuredClone(
    fixtures["ProfileOperation/prepare-profile-operation"],
  );
  Object.assign(operation, {
    receiverActor: "urn:ame:accepted-software-delivery-receiver-service",
    receiverCardId: evidence.card,
    receiverCardSignatureId: evidence.signature,
    receiverKid: evidence.kid,
    receiverJwks: evidence.jwks,
  });
  const routesFile = join(root, "routes.json");
  writeFileSync(
    routesFile,
    JSON.stringify({
      version: 1,
      routes: [
        {
          actor: operation.receiverActor,
          account: null,
          agentCardUrl: `${baseUrl}/.well-known/agent-card.json`,
        },
      ],
    }),
  );
  const routes = readCoordinatorRoutes(routesFile);
  await verifyReceiverProfileEvidence({
    routes,
    operation,
    dataRoot: root,
    discover: async () => signed,
  });
  const changed = structuredClone(operation);
  changed.receiverKid = "wrong";
  await assert.rejects(
    verifyReceiverProfileEvidence({
      routes,
      operation: changed,
      dataRoot: root,
      discover: async () => signed,
    }),
    /actor-route-drift/u,
  );
});
