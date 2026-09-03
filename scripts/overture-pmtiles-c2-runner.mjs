// Opt-in, credential-free GitHub Actions orchestration. Never launches a local browser.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectDeclaredPackageEntries } from '../editor/core/package-store.js';
import { ensurePmtilesTool } from './lib/pmtiles-tool.mjs';
import { parsePmtilesDryRun } from './lib/freeze-project.mjs';
import { deriveOvertureBuildingsPmtilesUrl } from '../src/overture-pmtiles.js';
import toolLock from './tools/go-pmtiles-1.31.2.json' with {type:'json'};
import { captureFreezePlan, certifyBrowser, certifyC1Functional, hashFile, verifySnapshot, measureOfficialDiagnostics, prepareUnchangedC1Page } from './overture-pmtiles-c2-browser-certification.mjs';

const ROOT = fileURLToPath(new URL('..',import.meta.url));
const BASE = '88e6c4c88088b8170d8c592aab004e275b1b8fc2';
const TREE = '427ca7dc07b3889a8d250d013e21ff73c53ab684';
const STORY = 'data/stories/route-61-2.story.json';
const PROTECTED = ['data/schemas/story-1.1.schema.json','data/schemas/story-1.2.schema.json',STORY,'src/map/geojson-renderer.js','data/context/my-phuoc-1-buildings.geojson'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (value,message) => { if(!value) throw new Error(message); };

export function storyByteEvidence(bytes) {
  return { rawSha256:sha256(bytes), rawBytes:bytes.length,
    canonicalCrlfSha256:sha256(Buffer.from(bytes.toString('utf8').replace(/\r\n?|\n/g,'\r\n'))),
    convention:'Raw checkout bytes are copied unchanged; canonical CRLF digest is computed only, matching tests/editor-certification.test.mjs.' };
}

export function classifyRun({c1ExitCode,c1Functional,c2}) {
  const c1FunctionalCovered = !c1Functional?.error && c1Functional?.assessment?.functional==='PASS'
    && c1Functional?.preActivation?.requestCount===0 && c1Functional?.myPhuoc?.rangeOr206===true
    && c1Functional?.thuDauMot?.rangeOr206===true && c1Functional?.myPhuoc?.renderedFeatures>0
    && c1Functional?.thuDauMot?.renderedFeatures>0 && c1Functional?.cardinality?.mapsConstructed===1
    && c1Functional?.reuse?.mapsConstructed===1 && c1Functional?.remoteFailure?.status==='unavailable';
  const passed = c1FunctionalCovered
    && !c2?.error && c2?.assessment?.functional==='PASS';
  return { result:passed?'FUNCTIONAL_CI_PASS_EXTERNAL_AND_HARDWARE_PENDING':'FAILED_AVAILABLE_GATES',
    c1UnchangedHarness:c1ExitCode===0?'PASS':'PERFORMANCE_OR_OTHER_DIAGNOSTIC_RECORDED',
    performanceAuthority:'SOFTWARE_RENDERED_DIAGNOSTIC_ONLY', r2:'PENDING_EXTERNAL_ENDPOINT', physicalGpu:'NOT_MEASURED' };
}

async function inventory(root) {
  const result = {};
  async function walk(relative='') {
    for(const item of await readdir(path.join(root,relative),{withFileTypes:true})) {
      const name=path.posix.join(relative,item.name);
      check(!item.isSymbolicLink(),'Certification inventory contains a link.');
      if(item.isDirectory()) await walk(name);
      else { check(item.isFile(),'Certification inventory has non-regular entry.'); result[name]=await hashFile(path.join(root,name)); }
    }
  }
  await walk(); return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}

export async function verifyDuplicateAndRemove(root,retained,duplicate) {
  const resolvedRoot=await realpath(root);
  check(path.resolve(retained)===path.join(resolvedRoot,'frozen-1') && path.resolve(duplicate)===path.join(resolvedRoot,'frozen-2'), 'Refusing non-owned duplicate target.');
  for(const location of [retained,duplicate]) check(!(await lstat(location)).isSymbolicLink() && await realpath(location)===location,'Refusing aliased duplicate path.');
  const evidence=[];
  for(const folder of [retained,duplicate]) {
    const manifestPath=path.join(folder,'project.json');
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
    const settings=manifest.capabilities.find(item=>item.id==='urban-context-v1').settings;
    evidence.push(await verifySnapshot(path.resolve(folder,manifest.assets[settings.snapshot.asset].src),manifestPath));
  }
  check(evidence[0].sha256===evidence[1].sha256 && evidence[0].bytes===evidence[1].bytes,'Clean Freeze hashes differ.');
  const [first,second]=await Promise.all([inventory(retained),inventory(duplicate)]);
  delete first['project.json']; delete second['project.json'];
  check(JSON.stringify(first)===JSON.stringify(second),'Duplicate publication resources differ.');
  // The only explicit duplicate-output deletion: exact resolved temporary sibling, verified above.
  await rm(duplicate,{recursive:true,force:false});
  return {match:true,sha256:evidence[0].sha256,bytes:evidence[0].bytes,retained,removed:duplicate,removedAt:new Date().toISOString()};
}

async function command(command,args,{cwd=ROOT,timeout=900000,logPrefix}={}) {
  const startedAt=new Date().toISOString();
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,windowsHide:true,env:process.env});
    const stdout=[],stderr=[];
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeout);
    child.stdout.on('data',chunk=>stdout.push(chunk)); child.stderr.on('data',chunk=>stderr.push(chunk));
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);resolve({code,timedOut,stdout:Buffer.concat(stdout).toString(),stderr:Buffer.concat(stderr).toString()});});
  });
  const record={command,args,cwd,startedAt,finishedAt:new Date().toISOString(),...result};
  if(logPrefix) {
    await writeFile(`${logPrefix}.stdout.log`,result.stdout); await writeFile(`${logPrefix}.stderr.log`,result.stderr);
    await writeFile(`${logPrefix}.json`,JSON.stringify(record,null,2)+'\n');
  }
  return record;
}

async function identity(logDir,label) {
  const fetch=await command('git',['fetch','origin','main:refs/remotes/origin/main'],{logPrefix:path.join(logDir,`${label}-git-fetch`)});
  check(fetch.code===0,'Exact-main fetch failed.');
  const git=async args=>{const result=await command('git',args);check(result.code===0,`git ${args.join(' ')} failed`);return result.stdout.trim();};
  const head=await git(['rev-parse','HEAD']), main=await git(['rev-parse','origin/main']), mergeBase=await git(['merge-base','HEAD','origin/main']), tree=await git(['rev-parse','origin/main^{tree}']);
  check(head===process.env.EXPECTED_C2_HEAD,'Not the exact opted-in PR head.');
  check(main===BASE && mergeBase===BASE && tree===TREE,'Canonical main/base/tree drift.');
  const protectedDiff=await git(['diff',BASE,'--',...PROTECTED]); check(protectedDiff==='','Protected-file diff is not empty.');
  const story=storyByteEvidence(await readFile(path.join(ROOT,STORY)));
  check(story.rawSha256==='5f374a8901866c23e473107f4279f929304ec0645c170d3340ad028ac89267a9','Linux raw Story hash differs from baseline Git blob.');
  check(story.canonicalCrlfSha256==='29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a','Canonical Story digest differs.');
  return {head,main,mergeBase,tree,protectedDiff,story,checkedAt:new Date().toISOString()};
}

async function copyAuthoring(destination) {
  const manifest=JSON.parse(await readFile(path.join(ROOT,'project.json'),'utf8'));
  for(const relative of new Set(['project.json',...collectDeclaredPackageEntries(manifest).map(entry=>entry.path)])) {
    await mkdir(path.dirname(path.join(destination,relative)),{recursive:true});
    await copyFile(path.join(ROOT,relative),path.join(destination,relative));
  }
  return inventory(destination);
}

export async function runCertification() {
  check(process.env.GITHUB_ACTIONS==='true' && process.platform==='linux' && process.env.RUNNER_TEMP,'Run only in the approved ephemeral Linux Actions environment.');
  const artifactRoot=path.join(await realpath(process.env.RUNNER_TEMP),'map-story-c2-evidence');
  await mkdir(artifactRoot,{recursive:true});
  const work=await mkdtemp(path.join(artifactRoot,'run-'));
  const result={startedAt:new Date().toISOString(),expectedHead:process.env.EXPECTED_C2_HEAD,actionsRunId:process.env.GITHUB_RUN_ID,actionsRunAttempt:process.env.GITHUB_RUN_ATTEMPT,work,errors:[],c1ExitCode:null,c1Functional:null,c2:null};
  const save=()=>writeFile(path.join(work,'result.json'),JSON.stringify(result,null,2)+'\n');
  let frozen;
  try {
    result.identity=await identity(work,'initial'); await save();
    const authoring=path.join(work,'authoring'),planPath=path.join(work,'freeze-plan.json');
    const before=await copyAuthoring(authoring);
    result.authoringBefore=before;
    result.capture=await captureFreezePlan({url:'http://127.0.0.1:8080/',projectDir:authoring,planPath}); await save();
    // Re-fetch immediately before native extraction, not just at workflow start.
    result.preExtractionIdentity=await identity(work,'pre-extraction'); await save();
    for(const number of [1,2]) {
      const output=path.join(work,`frozen-${number}`);
      const run=await command(process.execPath,[path.join(ROOT,'scripts/freeze-overture-snapshot.mjs'),`--project=${authoring}`,`--plan=${planPath}`,`--output=${output}`],{logPrefix:path.join(work,`freeze-${number}`),timeout:900000});
      check(run.code===0,`Real Freeze ${number} failed; see retained stdout/stderr.`);
      result[`freeze${number}`]=JSON.parse(run.stdout); await save();
    }
    result.authoringAfter=await inventory(authoring);
    check(JSON.stringify(before)===JSON.stringify(result.authoringAfter),'Authoring Folder bytes changed.');
    const tool=await ensurePmtilesTool({cacheRoot:path.join(process.env.RUNNER_TEMP,'map-story-c2-tool-cache')});
    result.toolVersion=(await command(tool,['version'],{logPrefix:path.join(work,'native-version')})).stdout.trim();
    const lockedArchive=toolLock.artifacts[`${process.platform}-${process.arch}`];
    result.toolArchive={name:lockedArchive.name,sha256:await hashFile(path.join(path.dirname(tool),lockedArchive.name))};
    check(result.toolArchive.sha256===lockedArchive.sha256,'Pinned tool archive identity mismatch.');
    const dry=await command(tool,['extract',deriveOvertureBuildingsPmtilesUrl(result.capture.plan.overtureRelease),path.join(work,'dry-run-unused.pmtiles'),`--bbox=${result.capture.plan.finalBounds.join(',')}`,'--minzoom=11','--download-threads=4','--overfetch=0.05','--dry-run'],{logPrefix:path.join(work,'separate-native-dry-run')});
    check(dry.code===0,'Evidence dry-run failed.');
    result.separateDryRun=parsePmtilesDryRun(`${dry.stdout}\n${dry.stderr}`);
    result.duplicate=await verifyDuplicateAndRemove(work,path.join(work,'frozen-1'),path.join(work,'frozen-2'));
    console.log(`Removed verified duplicate ${result.duplicate.removed}; retained ${result.duplicate.retained}`);
    frozen=path.join(work,'frozen-1'); await save();
  } catch(error) { result.errors.push(error.stack ?? String(error)); await save(); }

  // C1 runs unchanged, in its own temporary cwd. Failure does not skip C2 measurements.
  const c1Dir=path.join(work,'c1'); await mkdir(c1Dir);
  try {
    await prepareUnchangedC1Page('http://127.0.0.1:8080/');
    const c1=await command(process.execPath,[path.join(ROOT,'scripts/overture-pmtiles-browser-certification.mjs'),'--url=http://127.0.0.1:8080/'],{cwd:c1Dir,logPrefix:path.join(work,'c1-unchanged'),timeout:600000});
    result.c1ExitCode=c1.code;
    if(c1.code===0) result.c1=JSON.parse(c1.stdout.slice(0,c1.stdout.lastIndexOf('\nOVERTURE_PMTILES_C1_BROWSER_RESULT:')));
  } catch(error) { result.errors.push(error.stack ?? String(error)); }
  try {
    result.c1Functional=await certifyC1Functional({url:'http://127.0.0.1:8080/'});
    await writeFile(path.join(work,'c1-functional.json'),JSON.stringify(result.c1Functional,null,2)+'\n');
  } catch(error) { result.c1Functional={error:error.stack??String(error),assessment:{functional:'FAIL',performance:'NOT_MEASURED'}}; result.errors.push(error.stack ?? String(error)); }
  if(frozen) {
    try {
      result.officialDiagnostic=await measureOfficialDiagnostics({url:'http://127.0.0.1:8080/',projectDir:path.join(work,'authoring')});
      await writeFile(path.join(work,'same-runner-official-diagnostic.json'),JSON.stringify(result.officialDiagnostic,null,2)+'\n');
    } catch(error) { result.errors.push(error.stack ?? String(error)); }
    try {
      const smoke=path.join(work,'frozen-folder-smoke'); await cp(frozen,smoke,{recursive:true,errorOnExist:true,force:false});
      const prior=process.cwd(); process.chdir(work);
      try { result.c2=await certifyBrowser({url:'http://127.0.0.1:8080/',snapshot:path.join(smoke,'assets/context/overture-buildings.pmtiles'),manifest:path.join(smoke,'project.json')}); }
      finally { process.chdir(prior); }
      await writeFile(path.join(work,'c2-browser.json'),JSON.stringify(result.c2,null,2)+'\n');
    } catch(error) { result.errors.push(error.stack ?? String(error)); }
  }
  result.classification=classifyRun(result);
  if(result.errors.length) result.classification.result='FAILED_AVAILABLE_GATES';
  if(result.c1 && result.c2?.fps) result.sameRunnerFpsRatio=result.c2.fps.averageFps/result.c1.onlineFps.averageFps;
  if(result.officialDiagnostic?.fps && result.c2?.fps) result.sameViewportDiagnosticFpsRatio=result.c2.fps.averageFps/result.officialDiagnostic.fps.averageFps;
  result.finishedAt=new Date().toISOString(); await save();
  console.log(JSON.stringify(result.classification));
  return result;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { const result=await runCertification(); if(result.classification.result==='FAILED_AVAILABLE_GATES')process.exitCode=1; }
  catch(error) { console.error(error.stack ?? error); process.exitCode=1; }
}
