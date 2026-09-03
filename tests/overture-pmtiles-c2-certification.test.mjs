import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import * as harness from '../scripts/overture-pmtiles-c2-browser-certification.mjs';
import * as runner from '../scripts/overture-pmtiles-c2-runner.mjs';

test('C2 command rejects ambiguous inputs before connecting to a browser', () => {
  assert.equal(typeof harness.parseArgs, 'function');
  const valid = ['--url=http://127.0.0.1:8080/', '--snapshot=/tmp/a.pmtiles', '--manifest=/tmp/project.json'];
  assert.equal(harness.parseArgs(valid).url, 'http://127.0.0.1:8080/');
  for (const args of [[], [...valid, '--url=x'], [...valid, '--secret=x'], valid.slice(0, 2), valid.map(a => a.replace('127.0.0.1', 'example.org'))]) {
    assert.throws(() => harness.parseArgs(args));
  }
});

test('real instrumentation records reinstalls and native File reads without changing return values', async () => {
  const window={addEventListener(){}};
  class MapSurface { on(){} addSource(){return this;} addLayer(){return this;} removeSource(){return this;} removeLayer(){return this;} }
  class NativeTestFile extends File {}
  class FakeFileSource {constructor(file){this.file=file;}}
  const context={window,File:NativeTestFile,URL:{createObjectURL(){return'blob:test';}},performance,PerformanceObserver:{supportedEntryTypes:[]},requestAnimationFrame(){}};
  vm.runInNewContext(`(${harness.browserInstrumentation.toString()})()`,context);
  window.maplibregl={Map:MapSurface,addProtocol(){return 7;}};
  window.pmtiles={FileSource:FakeFileSource};
  const map=new window.maplibregl.Map();
  assert.equal(map.addSource('overture-industrial-buildings',{}),map);
  map.removeSource('overture-industrial-buildings');map.addSource('overture-industrial-buildings',{});
  assert.equal(window.maplibregl.addProtocol('pmtiles',()=>{}),7);
  const file=new NativeTestFile(['abcdef'],'snapshot.pmtiles');
  const source=new window.pmtiles.FileSource(file);
  assert.equal(source.file,file);
  assert.equal(await file.slice(1,4).text(),'bcd');
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(),'abcdef');
  assert.deepEqual([window.__C2.sourceAdds,window.__C2.sourceRemoves,window.__C2.protocols,window.__C2.fileSources,window.__C2.slices,window.__C2.bytes,window.__C2.fullReads],[2,1,1,1,1,3,1]);
});

test('runner fails before filesystem/browser work outside approved Actions environment', () => {
  const execution=spawnSync(process.execPath,['scripts/overture-pmtiles-c2-runner.mjs'],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false'}});
  assert.equal(execution.status,1);
  assert.match(execution.stderr,/approved ephemeral Linux Actions environment/);
});

test('Linux Story evidence preserves raw bytes while checking the explicit canonical-CRLF convention', () => {
  assert.equal(typeof runner.storyByteEvidence, 'function');
  const raw=Buffer.from('first\nsecond\n');
  const evidence=runner.storyByteEvidence(raw);
  assert.notEqual(evidence.rawSha256,evidence.canonicalCrlfSha256);
  assert.deepEqual(raw,Buffer.from('first\nsecond\n'));
  assert.equal(evidence.rawBytes,13);
  assert.equal(runner.storyByteEvidence(Buffer.from('first\r\nsecond\r\n')).canonicalCrlfSha256,evidence.canonicalCrlfSha256);
});

test('same-runner classification preserves failed C1 gates even when C2 functional checks pass', () => {
  assert.equal(typeof runner.classifyRun, 'function');
  const c2={assessment:{functional:'PASS',performance:'PASS'}};
  assert.equal(runner.classifyRun({c1ExitCode:1,c2}).result,'FAILED_AVAILABLE_GATES');
  assert.equal(runner.classifyRun({c1ExitCode:0,c2:{assessment:{functional:'FAIL',performance:'PASS'}}}).result,'FAILED_AVAILABLE_GATES');
  assert.equal(runner.classifyRun({c1ExitCode:0,c2:{...c2,error:'late ZIP failure'}}).result,'FAILED_AVAILABLE_GATES');
  const clean=runner.classifyRun({c1ExitCode:0,c2});
  assert.equal(clean.result,'FUNCTIONAL_CI_PASS_EXTERNAL_AND_HARDWARE_PENDING');
  assert.equal(clean.r2,'PENDING_EXTERNAL_ENDPOINT');
  assert.equal(clean.physicalGpu,'NOT_MEASURED');
});

test('duplicate deletion requires exact owned targets and equal artifact bytes, preserving the retained output', async () => {
  assert.equal(typeof runner.verifyDuplicateAndRemove, 'function');
  const root=await mkdtemp(path.join(tmpdir(),'c2-delete-'));
  const manifest={assets:{frozen:{type:'pmtiles',src:'./assets/test.pmtiles',mediaType:'application/vnd.pmtiles'}},capabilities:[{id:'urban-context-v1',settings:{buildingSource:'project-snapshot',snapshot:{asset:'frozen',byteLength:3,sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'}}}]};
  try {
    for(const name of ['frozen-1','frozen-2']) { await mkdir(path.join(root,name,'assets'),{recursive:true}); await writeFile(path.join(root,name,'assets/test.pmtiles'),'abc'); await writeFile(path.join(root,name,'project.json'),JSON.stringify(manifest)); }
    await assert.rejects(runner.verifyDuplicateAndRemove(root,path.join(root,'frozen-1'),root));
    await writeFile(path.join(root,'frozen-2/assets/test.pmtiles'),'bad');
    await assert.rejects(runner.verifyDuplicateAndRemove(root,path.join(root,'frozen-1'),path.join(root,'frozen-2')));
    assert.equal(await readFile(path.join(root,'frozen-2/assets/test.pmtiles'),'utf8'),'bad');
    await writeFile(path.join(root,'frozen-2/assets/test.pmtiles'),'abc');
    const evidence=await runner.verifyDuplicateAndRemove(root,path.join(root,'frozen-1'),path.join(root,'frozen-2'));
    assert.equal(evidence.match,true);
    await assert.rejects(readFile(path.join(root,'frozen-2/project.json')), {code:'ENOENT'});
    assert.equal(await readFile(path.join(root,'frozen-1/assets/test.pmtiles'),'utf8'),'abc');
  } finally { await rm(root,{recursive:true,force:true}); }
});

const profile = (id, width, height) => ({ id, width, height, scenes: [{ index: 4, id: 'service-area', bounds: [106.58, 11.1, 106.62, 11.16] }] });
test('profile certification rejects assigned styles without actual preview and map measurements', () => {
  assert.equal(typeof harness.verifyCapture, 'function');
  const plan = { profiles: [profile('desktop', 1920, 1080), profile('mobile', 390, 844)] };
  const records = [[1920,1080], [390,844]].map(([width,height]) => ({ index: 4, viewport: [width,height], canvas: [width,height], map: [width,height], bounds: [[106.58,11.1],[106.62,11.16]] }));
  assert.doesNotThrow(() => harness.verifyCapture(plan, records));
  assert.throws(() => harness.verifyCapture(plan, []));
  assert.throws(() => harness.verifyCapture(plan, [{ ...records[0], viewport: [900,600] }, records[1]]));
  assert.throws(() => harness.verifyCapture(plan, [{ ...records[0], map: [0,1080] }, records[1]]));
  assert.throws(() => harness.verifyCapture(plan, [{ ...records[0], bounds: [[0,0],[1,1]] }, records[1]]));
});

const counts = () => ({ maps: 1, canvases: 1, protocols: 1, sources: 1, flat: 1, extrusion: 1, sourceAdds: 1, flatAdds: 1, extrusionAdds: 1, sourceRemoves: 0, layerRemoves: 0, fileSources: 1 });
const measured = () => ({ before: { fullReads: 0, slices: 0, protocols: 0, sources: 0 }, firstActivation: { fullReads: 0, slices: 4, bytes: 35000 }, officialRequests: 0, countsBefore: counts(), countsAfter: counts(), renderedFeatures: 200, phases: ['bearing-360','pitch-0-target-0','pan-away-back'], fps: { averageFps: 60 }, activation: { worstFrameOrTaskGapMs: 25 }, errors: [] });
test('C2 functional gates catch eager reads, official fallback and source reinstalls hidden by final layer counts', () => {
  assert.equal(typeof harness.assessBrowserEvidence, 'function');
  assert.equal(harness.assessBrowserEvidence(measured()).functional, 'PASS');
  for (const change of [e => e.before.fullReads++, e => e.before.slices++, e => e.before.protocols++, e => e.officialRequests++, e => e.countsAfter.sourceAdds++, e => e.countsAfter.fileSources++, e => e.renderedFeatures = 0, e => e.phases.pop(), e => e.errors.push('unexpected expression error')]) {
    const e = measured(); change(e);
    assert.equal(harness.assessBrowserEvidence(e).functional, 'FAIL');
  }
});
test('C2 performance failures stay distinct from functional success and never become physical GPU certification', () => {
  assert.equal(typeof harness.assessBrowserEvidence, 'function');
  const e = measured(); e.activation.worstFrameOrTaskGapMs = 300; e.fps.averageFps = 20;
  const result = harness.assessBrowserEvidence(e);
  assert.equal(result.functional, 'PASS');
  assert.equal(result.performance, 'FAIL');
  assert.equal(result.physicalGpu, 'NOT_MEASURED');
  delete e.fps;
  assert.equal(harness.assessBrowserEvidence(e).performance, 'FAIL');
});
test('snapshot identity rejects incorrect manifest hash and length before browser activation', async () => {
  assert.equal(typeof harness.verifySnapshot, 'function');
  const dir = await mkdtemp(path.join(tmpdir(), 'c2-identity-'));
  try {
    await mkdir(path.join(dir, 'assets'));
    const snapshot = path.join(dir, 'assets/test.pmtiles');
    await writeFile(snapshot, 'abc');
    const manifest = { assets: { frozen: { type: 'pmtiles', src: './assets/test.pmtiles', mediaType: 'application/vnd.pmtiles' } }, capabilities: [{ id: 'urban-context-v1', settings: { buildingSource: 'project-snapshot', snapshot: { asset: 'frozen', byteLength: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', bounds: [1,2,3,4] } } }] };
    const manifestPath = path.join(dir, 'project.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.equal((await harness.verifySnapshot(snapshot, manifestPath)).sha256, manifest.capabilities[0].settings.snapshot.sha256);
    await writeFile(snapshot, 'abcd');
    await assert.rejects(harness.verifySnapshot(snapshot, manifestPath));
    assert.equal(await readFile(snapshot, 'utf8'), 'abcd');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
