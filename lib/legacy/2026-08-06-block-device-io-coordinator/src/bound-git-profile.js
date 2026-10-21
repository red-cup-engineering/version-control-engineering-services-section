#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  chmodSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { semanticBytes, semanticId } from "@red-cup-engineering/relation-model-notation-cbor-codec";
import {
  decodeCarrier,
  deriveManifest,
  encodeCarrier,
  fixtures,
  normalizeCarrierFamily,
  refusalFor,
  validatePrivateIndexReleaseBinding,
} from "./bound-git-profile-wire.js";
import {
  beginProfileOperation,
  profileHistory,
  readCarrierObject,
  readProviderAllocation,
  readRetiredMarker,
  recordDeviceReceipt,
  transitionProfileOperation,
  writeCarrierObject,
  writeProviderAllocation,
  writeRetiredMarker,
} from "./bound-git-profile-store.js";
import { createCoordinatorProductionContext } from "./bound-git-profile-auth.js";

const sleep = new Int32Array(new SharedArrayBuffer(4));

function token(id) {
  return String(id).split(";").at(-1).replaceAll(/[^A-Za-z0-9_-]/gu, "_");
}

function processStartTicks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  } catch {
    return undefined;
  }
}

function lockOwnerAlive(owner) {
  if (!Number.isSafeInteger(owner?.pid) || typeof owner?.startTicks !== "string") {
    return false;
  }
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code !== "EPERM") throw error;
  }
  return processStartTicks(owner.pid) === owner.startTicks;
}

export function acquireDeviceLock(
  path,
  { waitMilliseconds = 5000, now = Date.now } = {},
) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = now() + waitMilliseconds;
  const owner = {
    version: 1,
    pid: process.pid,
    startTicks: processStartTicks(process.pid),
    token: randomBytes(32).toString("base64url"),
    acquiredAt: new Date(now()).toISOString(),
  };
  const ownerPath = `${path}.owner.json`;
  let priorOwner;
  try {
    priorOwner = JSON.parse(readFileSync(ownerPath, "utf8"));
  } catch {
    priorOwner = null;
  }
  let recovered = priorOwner !== null && !lockOwnerAlive(priorOwner);
  while (true) {
    const control = `${path}.control-${owner.token}`;
    const ready = join(control, "ready");
    const release = join(control, "release");
    mkdirSync(control, { mode: 0o700 });
    const holder = spawn(
      "/usr/bin/flock",
      [
        "--exclusive",
        "--wait",
        String(Math.max(0.001, waitMilliseconds / 1000)),
        path,
        "/bin/sh",
        "-c",
        'touch "$3"; while kill -0 "$1" 2>/dev/null && test ! -e "$2"; do sleep 0.05; done',
        "bound-git-device-lock",
        String(process.pid),
        release,
        ready,
      ],
      { stdio: "ignore" },
    );
    while (
      !existsSync(ready) &&
      existsSync(`/proc/${holder.pid}`) &&
      now() < deadline
    ) {
      Atomics.wait(sleep, 0, 0, 10);
    }
    if (existsSync(ready)) {
      try {
        const inheritedOwner = JSON.parse(readFileSync(ownerPath, "utf8"));
        recovered = recovered || !lockOwnerAlive(inheritedOwner);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const ownerDescriptor = openSync(ownerPath, "w", 0o600);
      try {
        writeFileSync(ownerDescriptor, `${JSON.stringify(owner)}\n`);
        fsyncSync(ownerDescriptor);
      } finally {
        closeSync(ownerDescriptor);
      }
      const directory = openSync(dirname(path), "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
      return Object.freeze({
        recovered,
        release() {
          let current = null;
          try {
            current = JSON.parse(readFileSync(ownerPath, "utf8"));
          } catch (error) {
            if (error.code === "ENOENT") return;
            throw error;
          }
          if (current.token !== owner.token) throw new Error("device-lock-owner-drift");
          rmSync(ownerPath, { force: true });
          writeFileSync(release, "");
          const releaseDeadline = Date.now() + 1000;
          while (Date.now() < releaseDeadline) {
            const probe = spawnSync(
              "/usr/bin/flock",
              ["--exclusive", "--nonblock", path, "/bin/true"],
              { stdio: "ignore" },
            );
            if (probe.status === 0) break;
            Atomics.wait(sleep, 0, 0, 10);
          }
          holder.kill("SIGTERM");
          rmSync(control, { recursive: true, force: true });
        },
      });
    }
    holder.kill("SIGTERM");
    rmSync(control, { recursive: true, force: true });
    if (now() >= deadline) {
      throw Object.assign(new Error("queue-timeout"), { reason: "pre-effect" });
    }
    Atomics.wait(sleep, 0, 0, 10);
  }
}

export function verifyHostReadiness(
  descriptor,
  { execute = spawnSync, realpath = realpathSync, stat = statSync } = {},
) {
  if (!descriptor || !isAbsolute(descriptor.rootRealpath)) {
    throw new Error("host-readiness-refused");
  }
  if (realpath(descriptor.rootRealpath) !== descriptor.rootRealpath) {
    throw new Error("host-readiness-refused");
  }
  if (
    !isAbsolute(descriptor.gitDirRealpath) ||
    realpath(descriptor.gitDirRealpath) !== descriptor.gitDirRealpath
  ) {
    throw new Error("host-readiness-refused");
  }
  const rootState = stat(descriptor.rootRealpath);
  const gitState = stat(descriptor.gitDirRealpath);
  const rootMode = rootState.mode & 0o7777;
  const gitMode = gitState.mode & 0o7777;
  if (
    !rootState.isDirectory() ||
    !gitState.isDirectory() ||
    !Number.isSafeInteger(descriptor.ownerUid) ||
    rootState.uid !== descriptor.ownerUid ||
    gitState.uid !== descriptor.ownerUid ||
    !Number.isSafeInteger(descriptor.rootMode) ||
    !Number.isSafeInteger(descriptor.gitDirMode) ||
    rootMode !== descriptor.rootMode ||
    gitMode !== descriptor.gitDirMode
  ) {
    throw new Error("host-readiness-refused");
  }
  const gitDir = execute(
    "/usr/bin/git",
    ["-C", descriptor.rootRealpath, "rev-parse", "--absolute-git-dir"],
    { encoding: "utf8", env: fixedGitEnvironment() },
  );
  const objectFormat = execute(
    "/usr/bin/git",
    ["-C", descriptor.rootRealpath, "rev-parse", "--show-object-format"],
    { encoding: "utf8", env: fixedGitEnvironment() },
  );
  if (
    gitDir.status !== 0 ||
    realpath(gitDir.stdout.trim()) !== descriptor.gitDirRealpath ||
    objectFormat.status !== 0 ||
    objectFormat.stdout.trim() !== descriptor.objectFormat
  ) {
    throw new Error("host-readiness-refused");
  }
  if (descriptor.deviceRealpath !== null) {
    if (!isAbsolute(descriptor.deviceRealpath)) throw new Error("host-readiness-refused");
    const device = stat(descriptor.deviceRealpath);
    if (
      !device.isBlockDevice() ||
      device.rdev !== descriptor.deviceRdev
    ) {
      throw new Error("host-readiness-refused");
    }
  }
  if (typeof descriptor.filesystemUuid !== "string" || descriptor.filesystemUuid.length === 0) {
    throw new Error("host-readiness-refused");
  }
  const filesystem = execute(
    "/usr/bin/findmnt",
    ["-n", "-o", "SOURCE,UUID", "--target", descriptor.rootRealpath],
    { encoding: "utf8", env: fixedGitEnvironment() },
  );
  const [mountedSource, mountedUuid] = String(filesystem.stdout ?? "")
    .trim()
    .split(/\s+/u);
  if (
    filesystem.status !== 0 ||
    mountedUuid !== descriptor.filesystemUuid ||
    (descriptor.deviceRealpath !== null &&
      realpath(mountedSource) !== descriptor.deviceRealpath)
  ) {
    throw new Error("host-readiness-refused");
  }
  if (
    !isAbsolute(descriptor.liveIndexRealpath) ||
    dirname(descriptor.liveIndexRealpath) !== descriptor.gitDirRealpath
  ) {
    throw new Error("host-readiness-refused");
  }
  return Object.freeze({
    repositoryId: descriptor.repositoryId,
    rootRealpath: descriptor.rootRealpath,
    gitDirRealpath: descriptor.gitDirRealpath,
    filesystemUuid: descriptor.filesystemUuid,
    objectFormat: descriptor.objectFormat,
  });
}

function fixedGitEnvironment(extra = {}) {
  return {
    PATH: "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    ...extra,
  };
}

export function createGitRunner({
  rootRealpath,
  gitDirRealpath,
  gitExecutable = "/usr/bin/git",
}) {
  if (
    gitExecutable !== "/usr/bin/git" ||
    !isAbsolute(rootRealpath) ||
    !isAbsolute(gitDirRealpath)
  ) {
    throw new Error("provider-executable-unavailable");
  }
  const fixedArguments = Object.freeze([
    `--git-dir=${gitDirRealpath}`,
    `--work-tree=${rootRealpath}`,
    "-c",
    `core.worktree=${rootRealpath}`,
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "-c",
    "core.attributesFile=/dev/null",
    "-c",
    "core.excludesFile=/dev/null",
    "-c",
    "protocol.allow=never",
  ]);
  return (args, { input, privateIndex = false, allowFailure = false } = {}) => {
    const extra = privateIndex ? { GIT_INDEX_FILE: privateIndex } : {};
    const result = spawnSync(
      gitExecutable,
      [...fixedArguments, ...args],
      {
        input,
        encoding: "utf8",
        env: fixedGitEnvironment(extra),
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    if (!allowFailure && result.status !== 0) {
      throw new Error(`git-effect-refused:${args[0]}:${result.stderr}`);
    }
    return result;
  };
}

function fsyncDirectory(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function privateIndexPaths(dataRoot, privateIndexId) {
  const parent = join(dataRoot, "private-indexes");
  const directory = join(parent, token(privateIndexId));
  return Object.freeze({
    parent,
    directory,
    index: join(directory, "index"),
  });
}

function requirePrivateIndexForRetirement(dataRoot, privateIndexId) {
  const paths = privateIndexPaths(dataRoot, privateIndexId);
  const directory = lstatSync(paths.directory);
  const index = lstatSync(paths.index);
  const owner = process.getuid?.();
  if (
    directory.isSymbolicLink() ||
    !directory.isDirectory() ||
    (directory.mode & 0o7777) !== 0o700 ||
    index.isSymbolicLink() ||
    !index.isFile() ||
    (index.mode & 0o7777) !== 0o600 ||
    (owner !== undefined && (directory.uid !== owner || index.uid !== owner)) ||
    readdirSync(paths.directory).sort().join("\0") !== "index"
  ) {
    throw Object.assign(new Error("private-index-drift"), {
      reason: "unresolved",
    });
  }
  return paths;
}

function normalizeRetiredMarker(value) {
  const keys = [
    "type",
    "version",
    "operationId",
    "publicRequestId",
    "allocationId",
    "privateIndexId",
    "retirementEvidenceId",
    "releaseResultId",
    "absentBytesProofId",
    "priorTransitionId",
    "timestamp",
  ];
  if (
    value?.type !== "PrivateIndexRetiredMarker" ||
    value.version !== 1 ||
    Object.keys(value).sort().join("\0") !== keys.sort().join("\0")
  ) {
    throw new Error("retired-marker-drift");
  }
  return Object.freeze(value);
}

function observedAbsence(dataRoot, privateIndexId) {
  const paths = privateIndexPaths(dataRoot, privateIndexId);
  for (const path of [paths.index, paths.directory]) {
    try {
      lstatSync(path);
      throw Object.assign(new Error("retirement-absence-drift"), {
        reason: "unresolved",
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return paths;
}

function entries(run, tree) {
  const out = run(["ls-tree", "-r", "-z", tree]).stdout;
  const result = [];
  for (const row of out.split("\0").filter(Boolean)) {
    const match = /^(\d{6}) (?:blob|commit) ([0-9a-f]+)\t(.+)$/u.exec(row);
    if (!match) throw new Error("unresolved-tree");
    result.push({
      repositoryPath: match[3],
      mode: match[1],
      blobId: match[2],
    });
  }
  return result.sort((left, right) =>
    Buffer.compare(Buffer.from(left.repositoryPath), Buffer.from(right.repositoryPath)),
  );
}

function targetEntries(all, targetRoot) {
  const prefix = targetRoot ? `${targetRoot}/` : "";
  return all
    .filter((entry) => !targetRoot || entry.repositoryPath.startsWith(prefix))
    .map((entry) => ({
      path: targetRoot ? entry.repositoryPath.slice(prefix.length) : entry.repositoryPath,
      mode: entry.mode,
      blobId: entry.blobId,
    }));
}

function nonTargetEntries(all, targetRoot) {
  const prefix = targetRoot ? `${targetRoot}/` : "";
  return targetRoot
    ? all.filter((entry) => !entry.repositoryPath.startsWith(prefix))
    : [];
}

function commitMessage(operation, candidateSubtreeId) {
  const metadata = operation.commitMetadata;
  return `${metadata.subject}\n${metadata.body ? `\n${metadata.body}` : ""}\nWork-Order: ${operation.workOrderId}\nStaged-Artifact: ${operation.artifactId}\nAssay: ${operation.assayId}\nOrigin-Readout: ${operation.originReadoutId}\nPublication-Journal: ${operation.journalId}\nCandidate-Plate: ${operation.candidatePlateId}\nTarget-Subtree: ${candidateSubtreeId}\nInduction-Transaction: ${metadata.transactionId}\n`;
}

function commitPreimage(operation, tree, parent, candidateSubtreeId) {
  const metadata = operation.commitMetadata;
  const author = `${metadata.author.name} <${metadata.author.email}> ${metadata.author.epochSeconds} ${metadata.author.timezone}`;
  const committer = `${metadata.committer.name} <${metadata.committer.email}> ${metadata.committer.epochSeconds} ${metadata.committer.timezone}`;
  return Buffer.from(
    `tree ${tree}\nparent ${parent}\nauthor ${author}\ncommitter ${committer}\n\n${commitMessage(operation, candidateSubtreeId)}`,
  );
}

export function gitCommitObjectId(preimage, objectFormat) {
  const algorithm = objectFormat === "sha1" ? "sha1" : objectFormat === "sha256" ? "sha256" : null;
  if (!algorithm) throw new Error("unknown-object-format");
  const header = Buffer.from(`commit ${preimage.length}\0`);
  return createHash(algorithm).update(header).update(preimage).digest("hex");
}

function identityReceipt(
  operation,
  kind,
  values,
  observed,
  deviceReceiptId,
  timestamp = new Date().toISOString(),
) {
  const receipt = structuredClone(fixtures[`ProfileReceipt/${kind}`]);
  for (const key of [
    "operationId",
    "publicRequestId",
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
    "repositoryId",
    "taskId",
    "sequence",
    "privateIndexId",
  ]) {
    receipt[key] = operation[key];
  }
  Object.assign(receipt, observed, values, {
    deviceReceiptId,
    priorTransitionId: semanticId({
      operationId: operation.operationId,
      state: "child-requested",
    }),
    timestamp,
  });
  receipt.transitionId = semanticId({
    priorTransitionId: receipt.priorTransitionId,
    operationId: operation.operationId,
    kind,
    values,
  });
  return normalizeCarrierFamily("ProfileReceipt", receipt);
}

function typedProfileRefusal(operation, reason) {
  const refusal = structuredClone(
    refusalFor({
      family: "ProfileOperation",
      value: operation,
      reason,
    }),
  );
  if (reason === "unresolved") refusal.state = "unresolved";
  return normalizeCarrierFamily("ProfileRefusal", refusal);
}

function currentHead(run, operation) {
  const result = run(
    ["rev-parse", "--verify", operation.declaredRef],
    { allowFailure: true },
  );
  return result.status === 0 ? result.stdout.trim() : null;
}

function commonObservation(operation, head) {
  return {
    observedHead: head,
    observedIndexTree: head,
    observedWorktreeId: semanticId({
      repositoryId: operation.repositoryId,
      head,
    }),
    observedTargetTree: head,
    observedCommitId: head,
  };
}

function providerAllocation(operation, descriptor, createdAt) {
  if (
    !/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(descriptor.descriptorId)
  ) {
    throw new Error("descriptor-identity-unavailable");
  }
  const allocation = {
    type: "ProviderPrivateIndexAllocation",
    version: 1,
    prepareOperationId: operation.operationId,
    publicPrepareRequestId: operation.publicRequestId,
  };
  for (const key of [
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
  ]) {
    allocation[key] = operation[key];
  }
  allocation.descriptorId = descriptor.descriptorId;
  allocation.createdAt = createdAt;
  return Object.freeze(allocation);
}

function retirementDeviceOutput({
  allocation,
  releaseResultId,
  proofRecord,
  markerRecord,
}) {
  return Object.freeze({
    allocationId: semanticId(allocation),
    releaseResultId,
    absentBytesProofId: proofRecord.id,
    absentProofBytes: proofRecord.bytes,
    retirementId: markerRecord.retirementId,
    retiredMarker: markerRecord.marker,
  });
}

function retirementCompletion(operation, {
  allocation,
  releaseResultId,
  proofRecord,
  markerRecord,
  dataRoot,
  head,
}) {
  const output = retirementDeviceOutput({
    allocation,
    releaseResultId,
    proofRecord,
    markerRecord,
  });
  const device = recordDeviceReceipt({
    root: dataRoot,
    operationId: operation.operationId,
    effect: "retire-private-index",
    output,
  });
  return Object.freeze({
    receipt: identityReceipt(
      operation,
      operation.kind,
      { retirementId: markerRecord.retirementId },
      commonObservation(operation, head),
      device.id,
      markerRecord.marker.timestamp,
    ),
    deviceReceipt: device.receipt,
    proof: Object.freeze({
      absentBytesProofId: proofRecord.id,
      absentBytesProof: proofRecord.carrier,
      releaseResultId,
      retirementId: markerRecord.retirementId,
    }),
  });
}

function executeRetirement(operation, {
  allocation,
  descriptor,
  dataRoot,
  head,
  priorTransitionId,
  fault = () => {},
}) {
  const { releaseResultId } = validatePrivateIndexReleaseBinding({
    operation,
    allocation,
  });
  if (
    allocation.descriptorId !== descriptor.descriptorId ||
    allocation.expectedOldHead !== operation.expectedOldHead ||
    allocation.declaredRef !== operation.declaredRef
  ) {
    throw new Error("binding-mismatch");
  }
  const paths = requirePrivateIndexForRetirement(
    dataRoot,
    operation.privateIndexId,
  );
  fault("before-unlink");
  unlinkSync(paths.index);
  fsyncDirectory(paths.directory);
  rmdirSync(paths.directory);
  fsyncDirectory(paths.parent);
  fault("after-unlink");
  observedAbsence(dataRoot, operation.privateIndexId);
  const observedAt = new Date().toISOString();
  const absentProof = normalizeCarrierFamily("PrivateIndexAbsentBytesProof", {
    type: "PrivateIndexAbsentBytesProof",
    version: 1,
    allocationId: operation.allocationId,
    privateIndexId: operation.privateIndexId,
    descriptorId: descriptor.descriptorId,
    retirementEvidenceId: operation.retirementEvidenceId,
    releaseResultId,
    indexEntryState: "absent",
    allocationDirectoryState: "absent",
    observedAt,
  });
  const absentBytesProofId = semanticId(absentProof);
  const proofRecord = writeCarrierObject({
    root: dataRoot,
    directory: "absence-proofs",
    id: absentBytesProofId,
    carrier: absentProof,
    family: "private-index-absence-proof",
  });
  fault("after-absence-proof");
  const marker = normalizeRetiredMarker({
    type: "PrivateIndexRetiredMarker",
    version: 1,
    operationId: operation.operationId,
    publicRequestId: operation.publicRequestId,
    allocationId: operation.allocationId,
    privateIndexId: operation.privateIndexId,
    retirementEvidenceId: operation.retirementEvidenceId,
    releaseResultId,
    absentBytesProofId,
    priorTransitionId,
    timestamp: observedAt,
  });
  const markerRecord = writeRetiredMarker({
    root: dataRoot,
    operationId: operation.operationId,
    marker,
  });
  fault("after-marker");
  return retirementCompletion(operation, {
    allocation,
    releaseResultId,
    proofRecord,
    markerRecord,
    dataRoot,
    head,
  });
}

function recoverRetirement(operation, context) {
  const { allocation } = readProviderAllocation({
    root: context.dataRoot,
    allocationId: operation.allocationId,
  });
  const { releaseResultId } = validatePrivateIndexReleaseBinding({
    operation,
    allocation,
  });
  try {
    const markerRecord = readRetiredMarker({
      root: context.dataRoot,
      operationId: operation.operationId,
      normalize: normalizeRetiredMarker,
    });
    const marker = markerRecord.marker;
    if (
      marker.operationId !== operation.operationId ||
      marker.publicRequestId !== operation.publicRequestId ||
      marker.allocationId !== operation.allocationId ||
      marker.privateIndexId !== operation.privateIndexId ||
      marker.retirementEvidenceId !== operation.retirementEvidenceId ||
      marker.releaseResultId !== releaseResultId ||
      marker.priorTransitionId !== context.priorTransitionId
    ) {
      throw new Error("retired-marker-drift");
    }
    const proofRecord = readCarrierObject({
      root: context.dataRoot,
      directory: "absence-proofs",
      id: marker.absentBytesProofId,
      normalize: (value) =>
        normalizeCarrierFamily("PrivateIndexAbsentBytesProof", value),
    });
    if (
      proofRecord.carrier.allocationId !== operation.allocationId ||
      proofRecord.carrier.privateIndexId !== operation.privateIndexId ||
      proofRecord.carrier.descriptorId !== context.descriptor.descriptorId ||
      proofRecord.carrier.retirementEvidenceId !==
        operation.retirementEvidenceId ||
      proofRecord.carrier.releaseResultId !== releaseResultId
    ) {
      throw new Error("absence-proof-drift");
    }
    observedAbsence(context.dataRoot, operation.privateIndexId);
    return retirementCompletion(operation, {
      allocation,
      releaseResultId,
      proofRecord,
      markerRecord,
      dataRoot: context.dataRoot,
      head: context.head,
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const paths = privateIndexPaths(context.dataRoot, operation.privateIndexId);
  if (!existsSync(paths.index)) {
    throw Object.assign(new Error("unresolved"), { reason: "unresolved" });
  }
  return executeRetirement(operation, { ...context, allocation });
}

function recoverStartedOperation(
  operation,
  { descriptor, dataRoot, run, createdAt, priorTransitionId, fault },
) {
  const head = currentHead(run, operation);
  if (operation.kind === "prepare-profile-operation") {
    return executeEffect(operation, {
      descriptor,
      dataRoot,
      run,
      createdAt,
      priorTransitionId,
      fault,
    });
  }
  if (operation.kind === "retire-profile-operation") {
    return recoverRetirement(operation, {
      descriptor,
      dataRoot,
      run,
      createdAt,
      priorTransitionId,
      fault,
      head,
    });
  }
  if (
    operation.kind === "publish-profile-operation" &&
    head === operation.preparedCommitId
  ) {
    const device = recordDeviceReceipt({
      root: dataRoot,
      operationId: operation.operationId,
      effect: "recover-published-ref",
      output: head,
    });
    return {
      receipt: identityReceipt(
        operation,
        operation.kind,
        {
          oldRefId: operation.expectedOldHead,
          newRefId: operation.preparedCommitId,
        },
        {
          ...commonObservation(operation, head),
          observedCommitId: operation.preparedCommitId,
        },
        device.id,
      ),
      deviceReceipt: device.receipt,
      proof: undefined,
    };
  }
  if (operation.kind === "synchronize-profile-operation") {
    const tree = run(
      ["write-tree"],
      { privateIndex: descriptor.liveIndexRealpath, allowFailure: true },
    );
    if (tree.status === 0 && tree.stdout.trim() === operation.intendedTreeId) {
      const output = tree.stdout.trim();
      const device = recordDeviceReceipt({
        root: dataRoot,
        operationId: operation.operationId,
        effect: "recover-live-index",
        output,
      });
      return {
        receipt: identityReceipt(
          operation,
          operation.kind,
          {
            liveIndexTreeId: output,
            worktreeProofId: semanticId({ tree: output, recovered: true }),
            nonTargetProofId: semanticId({
              tree: output,
              preparedCommitId: operation.preparedCommitId,
            }),
          },
          {
            ...commonObservation(operation, operation.expectedOldHead),
            observedIndexTree: output,
            observedCommitId: operation.preparedCommitId,
          },
          device.id,
        ),
        deviceReceipt: device.receipt,
        proof: undefined,
      };
    }
  }
  throw Object.assign(new Error("unresolved"), { reason: "unresolved" });
}

function executeEffect(
  operation,
  {
    descriptor,
    dataRoot,
    run,
    createdAt,
    priorTransitionId,
    fault,
  },
) {
  const head = currentHead(run, operation);
  if (
    operation.kind !== "retire-profile-operation" &&
    head !== operation.expectedOldHead
  ) {
    throw Object.assign(new Error("unresolved-head"), { reason: "unresolved" });
  }
  const common = commonObservation(operation, head);

  if (operation.kind === "prepare-profile-operation") {
    const before = entries(run, head);
    const oldTarget = targetEntries(before, operation.targetRoot);
    const derived = deriveManifest({
      artifactBytes: operation.artifactBytes,
      targetRoot: operation.targetRoot,
      expectedTargetEntries: oldTarget,
      objectFormat: descriptor.objectFormat,
    });
    if (derived.manifestId !== operation.candidatePlateId) {
      throw new Error("binding-mismatch");
    }
    const index = join(
      dataRoot,
      "private-indexes",
      token(operation.privateIndexId),
      "index",
    );
    mkdirSync(dirname(index), { recursive: true, mode: 0o700 });
    chmodSync(dirname(index), 0o700);
    run(["read-tree", head], { privateIndex: index });
    if (oldTarget.length) {
      run(["update-index", "--force-remove", "-z", "--stdin"], {
        privateIndex: index,
        input: Buffer.from(
          `${oldTarget
            .map((entry) =>
              operation.targetRoot
                ? `${operation.targetRoot}/${entry.path}`
                : entry.path,
            )
            .join("\0")}\0`,
        ),
      });
    }
    for (const entry of derived.manifest.entries) {
      const content = derived.artifact.files.find(
        (file) => file.path === entry.path,
      ).content;
      const blob = run(["hash-object", "-w", "--stdin"], {
        input: content,
      }).stdout.trim();
      if (blob !== entry.blobId) throw new Error("git-blob-identity-drift");
      run(
        [
          "update-index",
          "--add",
          "--cacheinfo",
          `${entry.mode},${entry.blobId},${entry.repositoryPath}`,
        ],
        { privateIndex: index },
      );
    }
    const tree = run(["write-tree"], { privateIndex: index }).stdout.trim();
    const after = entries(run, tree);
    const preparedTarget = after.filter((entry) =>
      operation.targetRoot
        ? entry.repositoryPath.startsWith(`${operation.targetRoot}/`)
        : true,
    );
    let subtree = operation.targetRoot
      ? run(["rev-parse", `${tree}:${operation.targetRoot}`], {
          allowFailure: true,
        }).stdout.trim()
      : tree;
    if (!subtree) subtree = run(["mktree"], { input: "" }).stdout.trim();
    const oldNonTarget = nonTargetEntries(before, operation.targetRoot);
    const preparedNonTarget = nonTargetEntries(after, operation.targetRoot);
    if (JSON.stringify(oldNonTarget) !== JSON.stringify(preparedNonTarget)) {
      throw new Error("non-target-drift");
    }
    const projection = derived.manifest.entries.map(
      ({ repositoryPath, mode, blobId }) => ({
        repositoryPath,
        mode,
        blobId,
      }),
    );
    if (JSON.stringify(preparedTarget) !== JSON.stringify(projection)) {
      throw new Error("target-projection-drift");
    }
    const targetProjectionId = semanticId({
      manifestId: derived.manifestId,
      preparedTargetEntries: preparedTarget,
      observedCandidateSubtreeId: subtree,
    });
    const nonTargetOldHeadProofId = semanticId({
      expectedOldHead: head,
      oldNonTargetEntries: oldNonTarget,
      preparedNonTargetEntries: preparedNonTarget,
    });
    const metadata = operation.commitMetadata;
    const environment = fixedGitEnvironment({
      GIT_AUTHOR_NAME: metadata.author.name,
      GIT_AUTHOR_EMAIL: metadata.author.email,
      GIT_AUTHOR_DATE: `@${metadata.author.epochSeconds} ${metadata.author.timezone}`,
      GIT_COMMITTER_NAME: metadata.committer.name,
      GIT_COMMITTER_EMAIL: metadata.committer.email,
      GIT_COMMITTER_DATE: `@${metadata.committer.epochSeconds} ${metadata.committer.timezone}`,
    });
    const preimage = commitPreimage(operation, tree, head, subtree);
    const expectedCommitId = gitCommitObjectId(preimage, descriptor.objectFormat);
    const commit = spawnSync(
      "/usr/bin/git",
      ["-C", descriptor.rootRealpath, "commit-tree", tree, "-p", head],
      {
        input: commitMessage(operation, subtree),
        encoding: "utf8",
        env: environment,
      },
    );
    if (commit.status !== 0) {
      throw new Error(`commit-tree-refused:${commit.stderr}`);
    }
    const commitId = commit.stdout.trim();
    if (commitId !== expectedCommitId) throw new Error("git-commit-identity-drift");
    chmodSync(index, 0o600);
    const allocation = writeProviderAllocation({
      root: dataRoot,
      allocation: providerAllocation(operation, descriptor, createdAt),
    });
    const device = recordDeviceReceipt({
      root: dataRoot,
      operationId: operation.operationId,
      effect: "prepare-private-tree",
      output: {
        tree,
        subtree,
        commitId,
        expectedCommitId,
        allocationId: allocation.allocationId,
      },
    });
    const proof = Object.freeze({
      expectedTargetEntries: oldTarget,
      preparedTargetEntries: preparedTarget,
      oldNonTargetEntries: oldNonTarget,
      preparedNonTargetEntries: preparedNonTarget,
      observedCandidateSubtreeId: subtree,
      observedFullTreeId: tree,
    });
    return {
      receipt: identityReceipt(
        operation,
        operation.kind,
        {
          manifestId: derived.manifestId,
          candidatePlateId: derived.manifestId,
          candidateSubtreeId: subtree,
          targetProjectionId,
          fullTreeId: tree,
          nonTargetOldHeadProofId,
          intendedTreeId: tree,
          preparedCommitId: commitId,
          allocationId: allocation.allocationId,
        },
        {
          ...common,
          observedIndexTree: tree,
          observedTargetTree: subtree,
          observedCommitId: commitId,
        },
        device.id,
      ),
      proof,
      deviceReceipt: device.receipt,
    };
  }

  if (operation.kind === "retire-profile-operation") {
    const { allocation } = readProviderAllocation({
      root: dataRoot,
      allocationId: operation.allocationId,
    });
    return executeRetirement(operation, {
      allocation,
      descriptor,
      dataRoot,
      head,
      priorTransitionId,
      fault,
    });
  }

  if (operation.kind === "synchronize-profile-operation") {
    run(["read-tree", operation.intendedTreeId], {
      privateIndex: descriptor.liveIndexRealpath,
    });
    run(["update-index", "--refresh"], {
      privateIndex: descriptor.liveIndexRealpath,
    });
    const tree = run(["write-tree"], {
      privateIndex: descriptor.liveIndexRealpath,
    }).stdout.trim();
    if (tree !== operation.intendedTreeId) throw new Error("live-index-drift");
    const work = run(["diff-files", "--quiet"], {
      privateIndex: descriptor.liveIndexRealpath,
      allowFailure: true,
    });
    if (work.status !== 0) throw new Error("worktree-drift");
    const device = recordDeviceReceipt({
      root: dataRoot,
      operationId: operation.operationId,
      effect: "synchronize-live-index",
      output: tree,
    });
    return {
      receipt: identityReceipt(
        operation,
        operation.kind,
        {
          liveIndexTreeId: tree,
          worktreeProofId: semanticId({ tree, status: work.status }),
          nonTargetProofId: semanticId({
            tree,
            preparedCommitId: operation.preparedCommitId,
          }),
        },
        {
          ...common,
          observedIndexTree: tree,
          observedCommitId: operation.preparedCommitId,
        },
        device.id,
      ),
      deviceReceipt: device.receipt,
    };
  }

  if (operation.kind === "publish-profile-operation") {
    const cas = run(
      [
        "update-ref",
        operation.declaredRef,
        operation.preparedCommitId,
        operation.expectedOldHead,
      ],
      { allowFailure: true },
    );
    if (cas.status !== 0) {
      throw Object.assign(new Error("unresolved"), { reason: "unresolved" });
    }
    const device = recordDeviceReceipt({
      root: dataRoot,
      operationId: operation.operationId,
      effect: "publish-declared-ref",
      output: operation.preparedCommitId,
    });
    return {
      receipt: identityReceipt(
        operation,
        operation.kind,
        {
          oldRefId: operation.expectedOldHead,
          newRefId: operation.preparedCommitId,
        },
        {
          ...common,
          observedHead: operation.preparedCommitId,
          observedCommitId: operation.preparedCommitId,
        },
        device.id,
      ),
      deviceReceipt: device.receipt,
    };
  }

  if (operation.kind === "inspect-profile-operation") {
    const device = recordDeviceReceipt({
      root: dataRoot,
      operationId: operation.operationId,
      effect: "inspect-binding",
      output: common,
    });
    return {
      receipt: identityReceipt(
        operation,
        operation.kind,
        { observedStateId: semanticId(common) },
        common,
        device.id,
      ),
      deviceReceipt: device.receipt,
    };
  }
  throw new Error("unknown-profile-operation");
}

export function readProfileProof({ dataRoot, operationId }) {
  return profileHistory({ root: dataRoot, operationId }).at(-1)?.proof;
}

export function executeProfileOperation(
  source,
  {
    descriptor,
    dataRoot,
    waitMilliseconds = 5000,
    hostAssay = verifyHostReadiness,
    run: injectedRun,
    fault,
  } = {},
) {
  const operation = normalizeCarrierFamily("ProfileOperation", source);
  if (
    !descriptor ||
    operation.repositoryId !== descriptor.repositoryId ||
    typeof dataRoot !== "string"
  ) {
    throw new Error("binding-mismatch");
  }
  hostAssay(descriptor);
  const lock = acquireDeviceLock(descriptor.deviceLockId, { waitMilliseconds });
  const run = injectedRun ?? createGitRunner(descriptor);
  const requestId = semanticId(operation);
  try {
    const begun = beginProfileOperation({
      root: dataRoot,
      operationId: operation.operationId,
      requestId,
    });
    if (begun.replay) {
      if (begun.record.receipt) {
        return normalizeCarrierFamily("ProfileReceipt", begun.record.receipt);
      }
      if (begun.record.refusal) {
        throw Object.assign(new Error(begun.record.refusal.reason), {
          reason: begun.record.refusal.reason,
          storedRefusal: begun.record.refusal,
        });
      }
      if (begun.record.state === "effect-started") {
        try {
          const recovered = recoverStartedOperation(operation, {
            descriptor,
            dataRoot,
            run,
            createdAt: begun.record.admittedAt,
            priorTransitionId: begun.record.transitionId,
            fault,
          });
          transitionProfileOperation({
            root: dataRoot,
            operationId: operation.operationId,
            requestId,
            state: "completed",
            ...recovered,
          });
          return recovered.receipt;
        } catch (error) {
          const refusal = typedProfileRefusal(operation, "unresolved");
          transitionProfileOperation({
            root: dataRoot,
            operationId: operation.operationId,
            requestId,
            state: "unresolved",
            refusal,
          });
          throw Object.assign(error, { storedRefusal: refusal });
        }
      }
    }
    const started = transitionProfileOperation({
      root: dataRoot,
      operationId: operation.operationId,
      requestId,
      state: "effect-started",
    });
    try {
      const completed = executeEffect(operation, {
        descriptor,
        dataRoot,
        run,
        createdAt: begun.record.admittedAt,
        priorTransitionId: started.transitionId,
        fault,
      });
      transitionProfileOperation({
        root: dataRoot,
        operationId: operation.operationId,
        requestId,
        state: "completed",
        ...completed,
      });
      return completed.receipt;
    } catch (error) {
      const reason = error.reason === "unresolved" ? "unresolved" : "pre-effect";
      const refusal = typedProfileRefusal(operation, reason);
      transitionProfileOperation({
        root: dataRoot,
        operationId: operation.operationId,
        requestId,
        state: reason === "unresolved" ? "unresolved" : "refused",
        refusal,
      });
      throw Object.assign(error, { reason, storedRefusal: refusal });
    }
  } finally {
    lock.release();
  }
}

export function handleProfileCarrier(bytes, context) {
  try {
    return encodeCarrier(
      "ProfileReceipt",
      executeProfileOperation(decodeCarrier("ProfileOperation", bytes), context),
    );
  } catch (error) {
    try {
      const operation = decodeCarrier("ProfileOperation", bytes);
      const refusal =
        error.storedRefusal ??
        typedProfileRefusal(
          operation,
          error.reason === "unresolved" ? "unresolved" : "pre-effect",
        );
      return encodeCarrier("ProfileRefusal", refusal);
    } catch {
      return encodeCarrier("WireRefusal", refusalFor({}));
    }
  }
}

export async function handleSignedProfileCarrier(bytes, context) {
  const operation = decodeCarrier("ProfileOperation", bytes);
  if (typeof context.authenticate !== "function") {
    throw new Error("authentication-custody-unavailable");
  }
  await context.authenticate(operation, bytes);
  const output = handleProfileCarrier(bytes, context);
  if (typeof context.signResult !== "function") {
    throw new Error("signing-custody-unavailable");
  }
  const signed = {
    bytes: output,
    jws: await context.signResult(output),
  };
  try {
    const receipt = decodeCarrier("ProfileReceipt", output);
    const completed = profileHistory({
      root: context.dataRoot,
      operationId: receipt.operationId,
    }).at(-1);
    if (
      !completed?.deviceReceipt ||
      semanticId(completed.deviceReceipt) !== receipt.deviceReceiptId
    ) {
      throw new Error("device-receipt-chain-unavailable");
    }
    signed.deviceReceipt = completed.deviceReceipt;
    signed.deviceReceiptJws = await context.signResult(
      semanticBytes(completed.deviceReceipt),
    );
    signed.profileEvidence = Object.freeze({
      deviceReceipt: completed.deviceReceipt,
      ...(completed.proof === undefined
        ? {}
        : { prepareProof: completed.proof }),
    });
    signed.profileEvidenceJws = await context.signResult(
      semanticBytes(signed.profileEvidence),
    );
  } catch (error) {
    if (error.message === "device-receipt-chain-unavailable") throw error;
  }
  return Object.freeze(signed);
}

export async function handleProductionProfileCarrier(bytes, configuration) {
  return handleSignedProfileCarrier(
    bytes,
    createCoordinatorProductionContext(configuration),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  throw new Error(
    "signed coordinator boundary requires an authenticated A2A context; unsigned stdin execution is disabled",
  );
}
