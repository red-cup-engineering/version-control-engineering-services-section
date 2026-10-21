import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  fixtures,
  decodeCarrier,
  encodeCarrier,
  normalizeCarrierFamily,
} from "../src/bound-git-profile-wire.js";

test("the coordinator carrier is the approved revision-15 executable", async () => {
  assert.equal(createHash("sha256").update(await readFile(new URL("../src/bound-git-profile-wire.js", import.meta.url))).digest("hex"), "189893a73d4944c52e326f61dfb6b8bbd3af94a4b20a72f674aa8c860e80ecf9");
  const output = JSON.parse(
    execFileSync(process.execPath, [
      fileURLToPath(new URL("../src/bound-git-profile-wire.js", import.meta.url)),
    ]),
  );
  assert.equal(output.directionBindingVectors, 10);
  assert.equal(
    output.vectorSha256,
    "a51790a818794dd9fd704a4059083162c6a2245a2e119301892f7645a15848bb",
  );
});

test("release, retirement and absence carriers are exact and bounded", () => {
  for (const [family, key] of [
    ["PrivateIndexReleaseEvidence", "PrivateIndexReleaseEvidence/journal-complete"],
    ["EvidenceResult", "EvidenceResult/private-index-release"],
    ["ProfileOperation", "ProfileOperation/retire-profile-operation"],
    ["PrivateIndexAbsentBytesProof", "PrivateIndexAbsentBytesProof"],
  ]) {
    const bytes = encodeCarrier(family, fixtures[key]);
    assert.deepEqual(decodeCarrier(family, bytes), normalizeCarrierFamily(family, fixtures[key]));
  }
  for (const releaseNonce of [
    "a".repeat(42),
    "a".repeat(44),
    `${"a".repeat(42)}=`,
    `${"a".repeat(42)}+`,
  ]) {
    assert.throws(
      () =>
        normalizeCarrierFamily("PrivateIndexReleaseEvidence", {
          ...fixtures["PrivateIndexReleaseEvidence/journal-complete"],
          releaseNonce,
        }),
      /releaseNonce/u,
    );
  }
  assert.throws(
    () =>
      normalizeCarrierFamily("PrivateIndexAbsentBytesProof", {
        ...fixtures.PrivateIndexAbsentBytesProof,
        indexEntryState: "present",
      }),
    /indexEntryState/u,
  );
});

test("profile fixtures use the frozen carrier", () => {
  const fixture = fixtures["ProfileOperation/inspect-profile-operation"];
  assert.equal(decodeCarrier("ProfileOperation", encodeCarrier("ProfileOperation", fixture)).kind, "inspect-profile-operation");
});
