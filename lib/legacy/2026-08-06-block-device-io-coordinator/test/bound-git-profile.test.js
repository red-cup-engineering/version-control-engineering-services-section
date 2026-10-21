import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { semanticId } from "@red-cup-engineering/relation-model-notation-cbor-codec";
import { decodeCarrier, deriveManifest, encodeArtifact, encodeCarrier, fixtures, normalizeCarrierFamily } from "../src/bound-git-profile-wire.js";
import { acquireDeviceLock, createGitRunner, executeProfileOperation, handleProfileCarrier, handleSignedProfileCarrier } from "../src/bound-git-profile.js";
import { profileHistory } from "../src/bound-git-profile-store.js";

function git(root,...args){const r=spawnSync("/usr/bin/git",["-C",root,...args],{encoding:"utf8"});assert.equal(r.status,0,r.stderr);return r.stdout.trim()}
function bind(fixture,kind,descriptor,head){const op=structuredClone(fixture);Object.assign(op,{kind,operationId:semanticId({kind,head}),repositoryId:descriptor.repositoryId,expectedOldHead:head,declaredRef:"refs/heads/main"});return op}
function retirementOperation({prepare,prepared,descriptor,expectedOldHead,label=""}){
  const release=structuredClone(fixtures["PrivateIndexReleaseEvidence/journal-complete"]);Object.assign(release,{receiverActor:prepare.receiverActor,receiverCardId:prepare.receiverCardId,receiverCardSignatureId:prepare.receiverCardSignatureId,receiverKid:prepare.receiverKid,receiverJwks:prepare.receiverJwks,gitActor:prepare.gitActor,repositoryId:prepare.repositoryId,receiverRootId:prepare.receiverRootId,evidenceRootId:prepare.evidenceRootId,taskId:prepare.taskId,workOrderId:prepare.workOrderId,journalId:prepare.journalId,privateIndexId:prepare.privateIndexId,allocationId:prepared.allocationId});
  const normalizedRelease=normalizeCarrierFamily("PrivateIndexReleaseEvidence",release),releaseBytes=encodeCarrier("PrivateIndexReleaseEvidence",normalizedRelease),retirementEvidenceId=semanticId(normalizedRelease),result=structuredClone(fixtures["EvidenceResult/private-index-release"]);Object.assign(result,{receiverActor:prepare.receiverActor,providerActor:prepare.gitActor,receiverCardId:prepare.receiverCardId,receiverCardSignatureId:prepare.receiverCardSignatureId,receiverKid:prepare.receiverKid,receiverJwks:prepare.receiverJwks,providerCardId:prepare.gitCardId,providerCardSignatureId:prepare.gitCardSignatureId,providerKid:prepare.gitKid,providerJwks:prepare.gitJwks,objectId:retirementEvidenceId,taskId:prepare.taskId,bytes:releaseBytes,sha256:retirementEvidenceId,length:releaseBytes.length,allocationId:prepared.allocationId,privateIndexId:prepare.privateIndexId,journalId:prepare.journalId});
  const releaseResult=normalizeCarrierFamily("EvidenceResult",result),releaseResultBytes=encodeCarrier("EvidenceResult",releaseResult),retire=bind(fixtures["ProfileOperation/retire-profile-operation"],"retire-profile-operation",descriptor,expectedOldHead);Object.assign(retire,{taskId:prepare.taskId,privateIndexId:prepare.privateIndexId,allocationId:prepared.allocationId,retirementEvidenceId,releaseResultBytes,releaseResultJws:{protected:"cHJvdGVjdGVk",payload:releaseResultBytes.toString("base64url"),signature:"c2lnbmF0dXJl"}});retire.operationId=semanticId({kind:"retire-profile-operation",publicRequestId:retire.publicRequestId,label});return normalizeCarrierFamily("ProfileOperation",retire)
}

test("prepare, synchronize, inspect and CAS publish execute through the fixed coordinator",async()=>{
  const root=mkdtempSync(join(tmpdir(),"bound-git-profile-"));
  try{
    git(root,"init","-b","main");git(root,"config","user.name","Fixture");git(root,"config","user.email","fixture@example.invalid");mkdirSync(join(root,"lib"));writeFileSync(join(root,"lib/a"),"old");git(root,"add","lib/a");git(root,"commit","-m","old");const head=git(root,"rev-parse","HEAD");
    const descriptor={descriptorId:semanticId({descriptor:"sha1-fixture"}),repositoryId:fixtures["ProfileOperation/prepare-profile-operation"].repositoryId,rootRealpath:root,gitDirRealpath:join(root,".git"),liveIndexRealpath:join(root,".git/index"),objectFormat:"sha1",filesystemUuid:"fixture",deviceLockId:join(root,"device.lock")},dataRoot=join(root,"provider-data");
    const prepare=bind(fixtures["ProfileOperation/prepare-profile-operation"],"prepare-profile-operation",descriptor,head);prepare.targetRoot="lib";prepare.artifactBytes=encodeArtifact({files:[{path:"a",content:"new"}]});prepare.candidatePlateId=deriveManifest({artifactBytes:prepare.artifactBytes,targetRoot:"lib",expectedTargetEntries:[{path:"a",mode:"100644",blobId:git(root,"rev-parse",`${head}:lib/a`)}],objectFormat:"sha1"}).manifestId;
    const prepared=executeProfileOperation(normalizeCarrierFamily("ProfileOperation",prepare),{descriptor,dataRoot,hostAssay:()=>true});assert.equal(prepared.kind,"prepare-profile-operation");assert.notEqual(prepared.preparedCommitId,head);
    writeFileSync(join(root,"lib/a"),"new");
    const sync=bind(fixtures["ProfileOperation/synchronize-profile-operation"],"synchronize-profile-operation",descriptor,head);sync.privateIndexId=prepare.privateIndexId;sync.intendedTreeId=prepared.intendedTreeId;sync.preparedCommitId=prepared.preparedCommitId;const synchronized=executeProfileOperation(sync,{descriptor,dataRoot,hostAssay:()=>true});assert.equal(synchronized.liveIndexTreeId,prepared.intendedTreeId);
    const inspect=bind(fixtures["ProfileOperation/inspect-profile-operation"],"inspect-profile-operation",descriptor,head);inspect.privateIndexId=prepare.privateIndexId;assert.equal(executeProfileOperation(inspect,{descriptor,dataRoot,hostAssay:()=>true}).kind,"inspect-profile-operation");
    let authenticated=0,signed=0;const signedResult=await handleSignedProfileCarrier(encodeCarrier("ProfileOperation",inspect),{descriptor,dataRoot,hostAssay:()=>true,authenticate:async()=>{authenticated++},signResult:async()=>{signed++;return {signature:"fixture"}}});assert.equal(decodeCarrier("ProfileReceipt",signedResult.bytes).kind,"inspect-profile-operation");assert.equal(authenticated,1);assert.equal(signed,3);assert.ok(signedResult.deviceReceipt);assert.ok(signedResult.deviceReceiptJws);assert.ok(signedResult.profileEvidenceJws);
    const publish=bind(fixtures["ProfileOperation/publish-profile-operation"],"publish-profile-operation",descriptor,head);publish.privateIndexId=prepare.privateIndexId;publish.intendedTreeId=prepared.intendedTreeId;publish.preparedCommitId=prepared.preparedCommitId;const published=executeProfileOperation(publish,{descriptor,dataRoot,hostAssay:()=>true});assert.equal(published.newRefId,prepared.preparedCommitId);assert.equal(git(root,"rev-parse","refs/heads/main"),prepared.preparedCommitId);
    assert.deepEqual(profileHistory({root:dataRoot,operationId:publish.operationId}).map(x=>x.state),["admitted","effect-started","completed"]);
    const drift=structuredClone(publish);drift.operationId=semanticId({kind:"publish-profile-operation",head,attempt:"drift"});const unresolved=decodeCarrier("ProfileRefusal",handleProfileCarrier(encodeCarrier("ProfileOperation",drift),{descriptor,dataRoot,hostAssay:()=>true}));assert.equal(unresolved.state,"unresolved");assert.equal(unresolved.reason,"unresolved");
  }finally{rmSync(root,{recursive:true,force:true})}
});

test("SHA-256 preparation constructs and independently checks the Git commit object",()=>{
  const root=mkdtempSync(join(tmpdir(),"bound-git-profile-sha256-"));
  try{
    git(root,"init","--object-format=sha256","-b","main");git(root,"config","user.name","Fixture");git(root,"config","user.email","fixture@example.invalid");mkdirSync(join(root,"lib"));writeFileSync(join(root,"lib/a"),"old");git(root,"add","lib/a");git(root,"commit","-m","old");const head=git(root,"rev-parse","HEAD");
    const descriptor={descriptorId:semanticId({descriptor:"sha256-fixture"}),repositoryId:fixtures["ProfileOperation/prepare-profile-operation"].repositoryId,rootRealpath:root,gitDirRealpath:join(root,".git"),liveIndexRealpath:join(root,".git/index"),objectFormat:"sha256",filesystemUuid:"fixture",deviceLockId:join(root,"device.lock")},dataRoot=join(root,"provider-data");
    const prepare=bind(fixtures["ProfileOperation/prepare-profile-operation"],"prepare-profile-operation",descriptor,head);prepare.targetRoot="lib";prepare.artifactBytes=encodeArtifact({files:[{path:"a",content:"new"}]});prepare.candidatePlateId=deriveManifest({artifactBytes:prepare.artifactBytes,targetRoot:"lib",expectedTargetEntries:[{path:"a",mode:"100644",blobId:git(root,"rev-parse",`${head}:lib/a`)}],objectFormat:"sha256"}).manifestId;
    const receipt=executeProfileOperation(normalizeCarrierFamily("ProfileOperation",prepare),{descriptor,dataRoot,hostAssay:()=>true});assert.match(receipt.preparedCommitId,/^[0-9a-f]{64}$/u);assert.equal(git(root,"cat-file","-t",receipt.preparedCommitId),"commit");
  }finally{rmSync(root,{recursive:true,force:true})}
});

test("allocation-bound receiver release retires one exact private index and replays",()=>{
  const root=mkdtempSync(join(tmpdir(),"bound-git-retire-"));
  try{
    git(root,"init","-b","main");git(root,"config","user.name","Fixture");git(root,"config","user.email","fixture@example.invalid");mkdirSync(join(root,"lib"));writeFileSync(join(root,"lib/a"),"old");git(root,"add","lib/a");git(root,"commit","-m","old");const head=git(root,"rev-parse","HEAD");
    const descriptor={descriptorId:semanticId({descriptor:"retirement-fixture"}),repositoryId:fixtures["ProfileOperation/prepare-profile-operation"].repositoryId,rootRealpath:root,gitDirRealpath:join(root,".git"),liveIndexRealpath:join(root,".git/index"),objectFormat:"sha1",filesystemUuid:"fixture",deviceLockId:join(root,"device.lock")},dataRoot=join(root,"provider-data");
    const prepare=bind(fixtures["ProfileOperation/prepare-profile-operation"],"prepare-profile-operation",descriptor,head);prepare.targetRoot="lib";prepare.artifactBytes=encodeArtifact({files:[{path:"a",content:"new"}]});prepare.candidatePlateId=deriveManifest({artifactBytes:prepare.artifactBytes,targetRoot:"lib",expectedTargetEntries:[{path:"a",mode:"100644",blobId:git(root,"rev-parse",`${head}:lib/a`)}],objectFormat:"sha1"}).manifestId;
    const prepared=executeProfileOperation(normalizeCarrierFamily("ProfileOperation",prepare),{descriptor,dataRoot,hostAssay:()=>true});
    const release=structuredClone(fixtures["PrivateIndexReleaseEvidence/journal-complete"]);
    Object.assign(release,{receiverActor:prepare.receiverActor,receiverCardId:prepare.receiverCardId,receiverCardSignatureId:prepare.receiverCardSignatureId,receiverKid:prepare.receiverKid,receiverJwks:prepare.receiverJwks,gitActor:prepare.gitActor,repositoryId:prepare.repositoryId,receiverRootId:prepare.receiverRootId,evidenceRootId:prepare.evidenceRootId,taskId:prepare.taskId,workOrderId:prepare.workOrderId,journalId:prepare.journalId,privateIndexId:prepare.privateIndexId,allocationId:prepared.allocationId});
    const normalizedRelease=normalizeCarrierFamily("PrivateIndexReleaseEvidence",release),releaseBytes=encodeCarrier("PrivateIndexReleaseEvidence",normalizedRelease),retirementEvidenceId=semanticId(normalizedRelease);
    const result=structuredClone(fixtures["EvidenceResult/private-index-release"]);
    Object.assign(result,{receiverActor:prepare.receiverActor,providerActor:prepare.gitActor,receiverCardId:prepare.receiverCardId,receiverCardSignatureId:prepare.receiverCardSignatureId,receiverKid:prepare.receiverKid,receiverJwks:prepare.receiverJwks,providerCardId:prepare.gitCardId,providerCardSignatureId:prepare.gitCardSignatureId,providerKid:prepare.gitKid,providerJwks:prepare.gitJwks,objectId:retirementEvidenceId,taskId:prepare.taskId,bytes:releaseBytes,sha256:retirementEvidenceId,length:releaseBytes.length,allocationId:prepared.allocationId,privateIndexId:prepare.privateIndexId,journalId:prepare.journalId});
    const releaseResult=normalizeCarrierFamily("EvidenceResult",result),releaseResultBytes=encodeCarrier("EvidenceResult",releaseResult);
    const retire=bind(fixtures["ProfileOperation/retire-profile-operation"],"retire-profile-operation",descriptor,head);
    Object.assign(retire,{taskId:prepare.taskId,privateIndexId:prepare.privateIndexId,allocationId:prepared.allocationId,retirementEvidenceId,releaseResultBytes,releaseResultJws:{protected:"cHJvdGVjdGVk",payload:releaseResultBytes.toString("base64url"),signature:"c2lnbmF0dXJl"}});
    retire.operationId=semanticId({kind:"retire-profile-operation",publicRequestId:retire.publicRequestId});
    const retired=executeProfileOperation(normalizeCarrierFamily("ProfileOperation",retire),{descriptor,dataRoot,hostAssay:()=>true});
    assert.equal(retired.kind,"retire-profile-operation");assert.match(retired.retirementId,/^ni:\/\/\/sha-256;/u);assert.equal(executeProfileOperation(retire,{descriptor,dataRoot,hostAssay:()=>true}).retirementId,retired.retirementId);
    assert.deepEqual(readdirSync(join(dataRoot,"private-indexes")),[]);
    const history=profileHistory({root:dataRoot,operationId:retire.operationId});assert.deepEqual(history.map(x=>x.state),["admitted","effect-started","completed"]);assert.equal(history.at(-1).proof.retirementId,retired.retirementId);assert.ok(history.at(-1).deviceReceipt.output.absentProofBytes instanceof Uint8Array);
    const operationToken=createHash("sha256").update(retire.operationId).digest("base64url");unlinkSync(join(dataRoot,"profile-operations",operationToken,"00000002.json"));
    const recovered=executeProfileOperation(retire,{descriptor,dataRoot,hostAssay:()=>true});assert.deepEqual(recovered,retired);assert.deepEqual(profileHistory({root:dataRoot,operationId:retire.operationId}).map(x=>x.state),["admitted","effect-started","completed"]);
  }finally{rmSync(root,{recursive:true,force:true})}
});

test("SHA-1 and SHA-256 publication advance and unrelated HEAD do not gate retirement",()=>{
  for(const objectFormat of ["sha1","sha256"]){
    const root=mkdtempSync(join(tmpdir(),`bound-git-lifecycle-${objectFormat}-`));
    try{
      const init=objectFormat==="sha256"?["init","--object-format=sha256","-b","main"]:["init","-b","main"];git(root,...init);git(root,"config","user.name","Fixture");git(root,"config","user.email","fixture@example.invalid");mkdirSync(join(root,"lib"));writeFileSync(join(root,"lib/a"),"old");git(root,"add","lib/a");git(root,"commit","-m","old");const expectedOldHead=git(root,"rev-parse","HEAD");
      const descriptor={descriptorId:semanticId({descriptor:`lifecycle-${objectFormat}`}),repositoryId:fixtures["ProfileOperation/prepare-profile-operation"].repositoryId,rootRealpath:root,gitDirRealpath:join(root,".git"),liveIndexRealpath:join(root,".git/index"),objectFormat,filesystemUuid:"fixture",deviceLockId:join(root,"device.lock")},dataRoot=join(root,"provider-data");
      const prepare=bind(fixtures["ProfileOperation/prepare-profile-operation"],"prepare-profile-operation",descriptor,expectedOldHead);prepare.targetRoot="lib";prepare.artifactBytes=encodeArtifact({files:[{path:"a",content:"new"}]});prepare.candidatePlateId=deriveManifest({artifactBytes:prepare.artifactBytes,targetRoot:"lib",expectedTargetEntries:[{path:"a",mode:"100644",blobId:git(root,"rev-parse",`${expectedOldHead}:lib/a`)}],objectFormat}).manifestId;
      const prepared=executeProfileOperation(normalizeCarrierFamily("ProfileOperation",prepare),{descriptor,dataRoot,hostAssay:()=>true});writeFileSync(join(root,"lib/a"),"new");
      const sync=bind(fixtures["ProfileOperation/synchronize-profile-operation"],"synchronize-profile-operation",descriptor,expectedOldHead);Object.assign(sync,{privateIndexId:prepare.privateIndexId,intendedTreeId:prepared.intendedTreeId,preparedCommitId:prepared.preparedCommitId});executeProfileOperation(sync,{descriptor,dataRoot,hostAssay:()=>true});
      const publish=bind(fixtures["ProfileOperation/publish-profile-operation"],"publish-profile-operation",descriptor,expectedOldHead);Object.assign(publish,{privateIndexId:prepare.privateIndexId,intendedTreeId:prepared.intendedTreeId,preparedCommitId:prepared.preparedCommitId});executeProfileOperation(publish,{descriptor,dataRoot,hostAssay:()=>true});assert.equal(git(root,"rev-parse","HEAD"),prepared.preparedCommitId);assert.notEqual(prepared.preparedCommitId,expectedOldHead);
      if(objectFormat==="sha256"){writeFileSync(join(root,"unrelated"),"advance");git(root,"add","unrelated");git(root,"commit","-m","unrelated head");assert.notEqual(git(root,"rev-parse","HEAD"),prepared.preparedCommitId)}
      const before={head:git(root,"rev-parse","HEAD"),ref:git(root,"rev-parse","refs/heads/main"),index:git(root,"write-tree"),worktree:readFileSync(join(root,"lib/a"),"utf8"),objects:git(root,"count-objects","-v")},retire=retirementOperation({prepare,prepared,descriptor,expectedOldHead,label:objectFormat}),retired=executeProfileOperation(retire,{descriptor,dataRoot,hostAssay:()=>true}),after={head:git(root,"rev-parse","HEAD"),ref:git(root,"rev-parse","refs/heads/main"),index:git(root,"write-tree"),worktree:readFileSync(join(root,"lib/a"),"utf8"),objects:git(root,"count-objects","-v")};
      assert.equal(retired.kind,"retire-profile-operation");assert.deepEqual(after,before);assert.deepEqual(readdirSync(join(dataRoot,"private-indexes")),[]);
    }finally{rmSync(root,{recursive:true,force:true})}
  }
});

test("host readiness is an executable assay and stale device locks recover",()=>{
  const descriptor={repositoryId:fixtures["ProfileOperation/inspect-profile-operation"].repositoryId,rootRealpath:"/not-used",objectFormat:"sha1",deviceLockId:join(tmpdir(),`occupied-${process.pid}`)};
  assert.throws(()=>executeProfileOperation(fixtures["ProfileOperation/inspect-profile-operation"],{descriptor,dataRoot:tmpdir(),hostAssay:()=>{throw new Error("host-readiness-refused")}}),/host-readiness-refused/u);
  writeFileSync(`${descriptor.deviceLockId}.owner.json`,JSON.stringify({version:1,pid:99999999,startTicks:"absent",token:"stale"}));
  try{const lock=acquireDeviceLock(descriptor.deviceLockId);assert.equal(lock.recovered,true);lock.release()}finally{rmSync(descriptor.deviceLockId,{force:true});rmSync(`${descriptor.deviceLockId}.owner.json`,{force:true})}
});

test("kernel-held device exclusion survives fresh-process contention",async()=>{
  const root=mkdtempSync(join(tmpdir(),"bound-git-lock-race-")),lockPath=join(root,"device.lock"),events=join(root,"events.jsonl");
  const moduleUrl=new URL("../src/bound-git-profile.js",import.meta.url).href;
  const source=`import {appendFileSync} from "node:fs";import {acquireDeviceLock} from ${JSON.stringify(moduleUrl)};const sleep=new Int32Array(new SharedArrayBuffer(4));const lock=acquireDeviceLock(process.argv[1],{waitMilliseconds:10000});appendFileSync(process.argv[2],JSON.stringify({kind:"enter",pid:process.pid})+"\\n");Atomics.wait(sleep,0,0,75);appendFileSync(process.argv[2],JSON.stringify({kind:"exit",pid:process.pid})+"\\n");lock.release();`;
  try{
    const children=Array.from({length:8},()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,lockPath,events],{stdio:["ignore","ignore","pipe"]});let stderr="";child.stderr.setEncoding("utf8");child.stderr.on("data",chunk=>{stderr+=chunk});child.on("error",reject);child.on("exit",status=>status===0?resolve():reject(new Error(`child ${status}: ${stderr}`)))}));
    await Promise.all(children);
    const rows=readFileSync(events,"utf8").trim().split("\n").map(JSON.parse);let held=0;
    for(const row of rows){held+=row.kind==="enter"?1:-1;assert.ok(held===0||held===1,`device overlap ${JSON.stringify(rows)}`)}
    assert.equal(held,0);assert.equal(rows.length,16);
  }finally{rmSync(root,{recursive:true,force:true})}
});

test("ambient Git variables and repository-local worktree configuration cannot escape the descriptor",()=>{
  const a=mkdtempSync(join(tmpdir(),"bound-git-confined-a-")),b=mkdtempSync(join(tmpdir(),"bound-git-confined-b-"));
  try{
    git(a,"init","-b","main");git(a,"config","user.name","A");git(a,"config","user.email","a@example.invalid");writeFileSync(join(a,"a"),"a");git(a,"add","a");git(a,"commit","-m","a");
    git(b,"init","-b","main");git(b,"config","user.name","B");git(b,"config","user.email","b@example.invalid");writeFileSync(join(b,"b"),"b");git(b,"add","b");git(b,"commit","-m","b");
    git(a,"config","core.worktree",b);
    const expected=git(a,"rev-parse","HEAD"),prior=process.env.GIT_DIR;process.env.GIT_DIR=join(b,".git");
    try{
      const run=createGitRunner({rootRealpath:a,gitDirRealpath:join(a,".git")});
      assert.equal(run(["rev-parse","HEAD"]).stdout.trim(),expected);
      assert.equal(run(["rev-parse","--show-toplevel"]).stdout.trim(),a);
    }finally{if(prior===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=prior}
  }finally{rmSync(a,{recursive:true,force:true});rmSync(b,{recursive:true,force:true})}
});
