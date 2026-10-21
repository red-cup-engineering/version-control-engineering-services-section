import { decodeSemantic, normalizeCarrier, semanticBytes, semanticId } from "@red-cup-engineering/relation-model-notation-cbor-codec";
import {
  closeSync,
  constants,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

function token(value) {
  return createHash("sha256").update(String(value)).digest("base64url");
}

function journalPath(root, operationId) {
  return join(root, "profile-operations", token(operationId));
}

function parseStoredJson(source) {
  return JSON.parse(source, (_key, value) =>
    value &&
    Object.keys(value).length === 1 &&
    typeof value.$bytes === "string"
      ? Buffer.from(value.$bytes, "base64url")
      : value,
  );
}

function readJournal(path) {
  try {
    return readdirSync(path)
      .filter((name) => /^\d{8}\.json$/u.test(name))
      .sort()
      .map((name) => parseStoredJson(readFileSync(join(path, name), "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function fsyncDirectory(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function mkdirDurably(path) {
  if (existsSync(path)) return;
  const parent = dirname(path);
  if (parent !== path) mkdirDurably(parent);
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  fsyncDirectory(path);
  fsyncDirectory(parent);
}

function writeImmutable(path, value) {
  const directory = dirname(path);
  mkdirDurably(directory);
  const temporary = join(
    directory,
    `.tmp-${process.pid}-${Date.now()}-${createHash("sha256").update(semanticBytes(value)).digest("hex")}`,
  );
  const body = `${JSON.stringify(value, (_key, item) => {
    if (item instanceof Uint8Array) {
      return { $bytes: Buffer.from(item).toString("base64url") };
    }
    if (
      item?.type === "Buffer" &&
      Array.isArray(item.data) &&
      item.data.every(Number.isSafeInteger)
    ) {
      return { $bytes: Buffer.from(item.data).toString("base64url") };
    }
    return item;
  })}\n`;
  const descriptor = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(descriptor, body);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    linkSync(temporary, path);
  } catch (error) {
    if (
      error.code !== "EEXIST" ||
      readFileSync(path, "utf8") !== body
    ) throw error;
  } finally {
    unlinkSync(temporary);
  }
  fsyncDirectory(directory);
}

function writeImmutableBytes(path, bytes) {
  const directory = dirname(path);
  mkdirDurably(directory);
  const temporary = join(
    directory,
    `.tmp-${process.pid}-${Date.now()}-${createHash("sha256").update(bytes).digest("hex")}`,
  );
  const descriptor = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    linkSync(temporary, path);
  } catch (error) {
    if (
      error.code !== "EEXIST" ||
      lstatSync(path).isSymbolicLink() ||
      !readFileSync(path).equals(Buffer.from(bytes))
    ) {
      throw error;
    }
  } finally {
    unlinkSync(temporary);
  }
  fsyncDirectory(directory);
}

const ALLOCATION_KEYS = Object.freeze([
  "type",
  "version",
  "prepareOperationId",
  "publicPrepareRequestId",
  "gitActor",
  "gitAccount",
  "gitCardId",
  "gitCardSignatureId",
  "gitKid",
  "gitJwks",
  "coordinatorActor",
  "coordinatorAccount",
  "coordinatorCardId",
  "coordinatorCardSignatureId",
  "coordinatorKid",
  "coordinatorJwks",
  "receiverActor",
  "receiverCardId",
  "receiverCardSignatureId",
  "receiverKid",
  "receiverJwks",
  "repositoryId",
  "receiverRootId",
  "evidenceRootId",
  "taskId",
  "workOrderId",
  "journalId",
  "sequence",
  "privateIndexId",
  "expectedOldHead",
  "declaredRef",
  "descriptorId",
  "createdAt",
]);

function exactCarrier(value, keys, type) {
  const normalized = normalizeCarrier(value);
  if (
    normalized?.type !== type ||
    normalized.version !== 1 ||
    Object.keys(normalized).sort().join("\0") !== keys.slice().sort().join("\0")
  ) {
    throw new Error("exact-key-mismatch");
  }
  return Object.freeze(normalized);
}

function allocationPath(root, allocationId) {
  return join(root, "allocations", `${token(allocationId)}.cbor`);
}

export function writeProviderAllocation({ root, allocation }) {
  const normalized = exactCarrier(
    allocation,
    ALLOCATION_KEYS,
    "ProviderPrivateIndexAllocation",
  );
  const allocationId = semanticId(normalized);
  const bytes = semanticBytes(normalized);
  writeImmutableBytes(allocationPath(root, allocationId), bytes);
  return Object.freeze({ allocationId, allocation: normalized, bytes });
}

export function readProviderAllocation({ root, allocationId }) {
  const path = allocationPath(root, allocationId);
  if (lstatSync(path).isSymbolicLink()) throw new Error("allocation-drift");
  const bytes = readFileSync(path);
  const allocation = exactCarrier(
    decodeSemantic(bytes),
    ALLOCATION_KEYS,
    "ProviderPrivateIndexAllocation",
  );
  if (
    semanticId(allocation) !== allocationId ||
    !Buffer.from(semanticBytes(allocation)).equals(bytes)
  ) {
    throw new Error("allocation-drift");
  }
  return Object.freeze({ allocationId, allocation, bytes });
}

export function writeCarrierObject({ root, directory, id, carrier, family }) {
  const bytes = semanticBytes(carrier);
  if (semanticId(carrier) !== id) throw new Error(`${family}-identity-drift`);
  const path = join(root, directory, `${token(id)}.cbor`);
  writeImmutableBytes(path, bytes);
  return Object.freeze({ id, carrier: Object.freeze(carrier), bytes, path });
}

export function readCarrierObject({ root, directory, id, normalize }) {
  const path = join(root, directory, `${token(id)}.cbor`);
  if (lstatSync(path).isSymbolicLink()) throw new Error("carrier-object-drift");
  const bytes = readFileSync(path);
  const carrier = normalize(decodeSemantic(bytes));
  if (
    semanticId(carrier) !== id ||
    !Buffer.from(semanticBytes(carrier)).equals(bytes)
  ) {
    throw new Error("carrier-object-drift");
  }
  return Object.freeze({ id, carrier, bytes, path });
}

function retiredMarkerPath(root, operationId) {
  return join(root, "retired-markers", `${token(operationId)}.cbor`);
}

export function writeRetiredMarker({ root, operationId, marker }) {
  const bytes = semanticBytes(marker);
  const retirementId = semanticId(marker);
  const path = retiredMarkerPath(root, operationId);
  writeImmutableBytes(path, bytes);
  return Object.freeze({ retirementId, marker: Object.freeze(marker), bytes, path });
}

export function readRetiredMarker({ root, operationId, normalize }) {
  const path = retiredMarkerPath(root, operationId);
  if (lstatSync(path).isSymbolicLink()) throw new Error("retired-marker-drift");
  const bytes = readFileSync(path);
  const marker = normalize(decodeSemantic(bytes));
  if (!Buffer.from(semanticBytes(marker)).equals(bytes)) {
    throw new Error("retired-marker-drift");
  }
  return Object.freeze({
    retirementId: semanticId(marker),
    marker,
    bytes,
    path,
  });
}

function appendDurably(path, value) {
  const index = readJournal(path).length;
  writeImmutable(join(path, `${String(index).padStart(8, "0")}.json`), value);
}

export function profileHistory({ root, operationId }) {
  return Object.freeze(
    readJournal(journalPath(root, operationId)).map(Object.freeze),
  );
}

export function beginProfileOperation({
  root,
  operationId,
  requestId,
  admittedAt = new Date().toISOString(),
}) {
  const path = journalPath(root, operationId);
  const history = readJournal(path);
  const prior = history.at(-1);
  if (prior) {
    if (prior.requestId !== requestId) throw new Error("operation-replay");
    return Object.freeze({ replay: true, record: Object.freeze(prior) });
  }
  const record = {
    version: 1,
    operationId,
    requestId,
    admittedAt,
    state: "admitted",
    priorTransitionId: semanticId({
      operationId,
      state: "unobserved",
    }),
  };
  record.transitionId = semanticId(record);
  appendDurably(path, record);
  return Object.freeze({ replay: false, record: Object.freeze(record) });
}

export function transitionProfileOperation({
  root,
  operationId,
  requestId,
  state,
  receipt,
  refusal,
  proof,
  deviceReceipt,
}) {
  const path = journalPath(root, operationId);
  const prior = readJournal(path).at(-1);
  if (!prior || prior.requestId !== requestId) throw new Error("operation-replay");
  const edges = {
    admitted: ["effect-started", "refused"],
    "effect-started": ["completed", "refused", "unresolved"],
  };
  if (!edges[prior.state]?.includes(state)) throw new Error("invalid-transition");
  const next = {
    ...prior,
    state,
    priorTransitionId: prior.transitionId,
  };
  delete next.transitionId;
  for (const [key, value] of Object.entries({
    receipt,
    refusal,
    proof,
    deviceReceipt,
  })) {
    if (value !== undefined) next[key] = value;
  }
  next.transitionId = semanticId(next);
  appendDurably(path, next);
  return Object.freeze(next);
}

export function recordDeviceReceipt({ root, operationId, effect, output }) {
  const receipt = Object.freeze({
    type: "BoundGitDeviceReceipt",
    version: 1,
    operationId,
    effect,
    output,
  });
  const id = semanticId(receipt);
  const path = join(root, "device-receipts", `${token(id)}.json`);
  const directory = dirname(path);
  mkdirDurably(directory);
  if (existsSync(path)) {
    const existing = parseStoredJson(readFileSync(path, "utf8"));
    if (semanticId(existing) !== id) throw new Error("device-receipt-identity-drift");
    return Object.freeze({ id, receipt: Object.freeze(existing) });
  }
  writeImmutable(path, receipt);
  return Object.freeze({ id, receipt });
}
