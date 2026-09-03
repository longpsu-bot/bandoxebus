import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectDeclaredPackageEntries } from '../editor/core/package-store.js';

const SOURCE = 'overture-industrial-buildings';
const FLAT = `${SOURCE}-flat`;
const EXTRUSION = `${SOURCE}-3d`;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const requireGate = (value, message) => { if (!value) throw new Error(message); };

export function parseArgs(args) {
  const values = {};
  for (const argument of args) {
    const match = /^--(url|snapshot|manifest)=(.+)$/.exec(argument);
    if (!match || values[match[1]]) throw new TypeError('Expected unique --url, --snapshot and --manifest options.');
    values[match[1]] = match[2];
  }
  if (Object.keys(values).length !== 3) throw new TypeError('All three options are required.');
  const url = new URL(values.url);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password) {
    throw new TypeError('Certification application must be on localhost HTTP.');
  }
  return { ...values, url: url.href, snapshot: path.resolve(values.snapshot), manifest: path.resolve(values.manifest) };
}

export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function verifySnapshot(snapshotPath, manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const settings = manifest.capabilities?.find(item => item.id === 'urban-context-v1')?.settings;
  const descriptor = manifest.assets?.[settings?.snapshot?.asset];
  requireGate(settings?.buildingSource === 'project-snapshot' && descriptor?.type === 'pmtiles', 'Expected frozen project-snapshot manifest.');
  requireGate(path.resolve(path.dirname(manifestPath), descriptor.src) === path.resolve(snapshotPath), 'Snapshot path does not match declared asset.');
  const bytes = (await stat(snapshotPath)).size;
  const sha256 = await hashFile(snapshotPath);
  requireGate(bytes > 0 && bytes <= 67108864 && bytes === settings.snapshot.byteLength && sha256 === settings.snapshot.sha256, 'Snapshot size/hash identity mismatch.');
  return { sha256, bytes, bounds: settings.snapshot.bounds, manifest };
}

export function verifyCapture(plan, captures) {
  requireGate(plan.profiles?.length === 2, 'Expected both Freeze profiles.');
  const expected = [[1920,1080], [390,844]];
  const scenes = plan.profiles.flatMap((profile, p) => {
    requireGate(profile.width === expected[p][0] && profile.height === expected[p][1], 'Incorrect Freeze profile.');
    return profile.scenes.map(scene => ({ ...scene, size: expected[p] }));
  });
  requireGate(captures.length === scenes.length && scenes.length > 0, 'Missing actual camera measurements.');
  scenes.forEach((scene, i) => {
    const actual = captures[i];
    requireGate(actual.index === scene.index, 'Captured wrong Scene.');
    for (const key of ['viewport','map','canvas']) {
      requireGate(actual[key]?.every((value, j) => value === scene.size[j]) && actual[key].length === 2, `Actual ${key} is not the exact Freeze profile.`);
    }
    requireGate(JSON.stringify(actual.bounds.flat()) === JSON.stringify(scene.bounds), 'Plan bounds differ from actual production camera capture.');
  });
}

export function assessBrowserEvidence(e) {
  const failures = [];
  const check = (value, message) => { if (!value) failures.push(message); };
  check(e.before?.fullReads === 0 && e.before?.slices === 0 && e.before?.protocols === 0 && e.before?.sources === 0, 'startup not lazy');
  check(e.firstActivation?.fullReads === 0 && e.firstActivation?.slices > 0 && e.firstActivation?.bytes > 0, 'missing bounded FileSource reads');
  check(e.officialRequests === 0, 'official Overture request in snapshot mode');
  for (const key of ['maps','canvases','protocols','sources','flat','extrusion','sourceAdds','flatAdds','extrusionAdds','fileSources']) {
    check(e.countsBefore?.[key] === 1 && e.countsAfter?.[key] === 1, `non-singleton ${key}`);
  }
  check(e.countsAfter?.sourceRemoves === 0 && e.countsAfter?.layerRemoves === 0, 'source/layer removed');
  check(e.renderedFeatures > 0, 'no rendered snapshot features');
  check(['bearing-360','pitch-0-target-0','pan-away-back'].every(phase => e.phases?.includes(phase)), 'camera sweep incomplete');
  check(Array.isArray(e.errors) && e.errors.length === 0, 'unexpected browser/map error');
  const performance = Number.isFinite(e.fps?.averageFps) && e.fps.averageFps >= 54
    && Number.isFinite(e.activation?.worstFrameOrTaskGapMs) && e.activation.worstFrameOrTaskGapMs <= 250;
  return { functional: failures.length ? 'FAIL' : 'PASS', failures, performance: performance ? 'PASS' : 'FAIL', physicalGpu: 'NOT_MEASURED' };
}

// Only observes real constructors, mutations and reads; no camera/source behavior is replaced.
export function browserInstrumentation() {
  const state = window.__C2 = { maps: [], protocols: 0, fileSources: 0, fullReads: 0, slices: 0, bytes: 0,
    sourceAdds: 0, flatAdds: 0, extrusionAdds: 0, sourceRemoves: 0, layerRemoves: 0, errors: [], captures: [], downloads: [] };
  const source = 'overture-industrial-buildings';
  const observedGlobal = (name, wrap) => {
    let value;
    Object.defineProperty(window, name, { configurable: true, get: () => value, set(next) { value = wrap(next); } });
  };
  observedGlobal('maplibregl', value => {
    if (!value?.Map) return value;
    const Original = value.Map;
    value.Map = class extends Original {
      constructor(...args) {
        super(...args); state.maps.push(this);
        this.on('error', event => state.errors.push(String(event.error?.message ?? event.message ?? 'map error')));
        for (const [method, field, match] of [
          ['addSource','sourceAdds',source], ['addLayer','flatAdds',`${source}-flat`], ['addLayer','extrusionAdds',`${source}-3d`],
          ['removeSource','sourceRemoves',source], ['removeLayer','layerRemoves',`${source}-flat`], ['removeLayer','layerRemoves',`${source}-3d`]
        ]) {
          const original = this[method].bind(this);
          this[method] = (...params) => { if ((params[0]?.id ?? params[0]) === match) state[field]++; return original(...params); };
        }
      }
    };
    const add = value.addProtocol.bind(value);
    value.addProtocol = (name, handler) => { if (name === 'pmtiles') state.protocols++; return add(name, handler); };
    return value;
  });
  observedGlobal('pmtiles', value => {
    if (!value?.FileSource) return value;
    const Original = value.FileSource;
    value.FileSource = class extends Original { constructor(...args) { super(...args); state.fileSources++; } };
    return value;
  });
  const slice = File.prototype.slice;
  File.prototype.slice = function(start = 0, end = this.size, ...rest) {
    if (this.name.endsWith('.pmtiles')) { state.slices++; state.bytes += Math.max(0, Math.min(end, this.size) - start); }
    return slice.call(this, start, end, ...rest);
  };
  const full = File.prototype.arrayBuffer;
  File.prototype.arrayBuffer = function() { if (this.name.endsWith('.pmtiles')) state.fullReads++; return full.call(this); };
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = blob => {
    if (blob.type === 'application/json') void blob.text().then(text => { try { state.downloads.push(JSON.parse(text)); } catch {} });
    return create(blob);
  };
  window.addEventListener('message', event => {
    if (event.data?.type !== 'editor-preview:freeze-camera') return;
    const frame = document.getElementById('production-preview');
    if (event.source !== frame?.contentWindow) return;
    const win = frame.contentWindow, map = win.__C2?.maps.at(-1);
    if (!map) return;
    const rect = map.getContainer().getBoundingClientRect(), canvas = map.getCanvas().getBoundingClientRect();
    state.captures.push({ ...event.data.payload, viewport: [win.innerWidth, win.innerHeight], map: [rect.width,rect.height], canvas: [canvas.width,canvas.height] });
  });
  state.startTiming = () => {
    const timing = state.timing = { active: true, last: null, worstFrameGapMs: 0, worstLongTaskMs: 0, startedAt: performance.now() };
    const frame = time => { if (!timing.active) return; if (timing.last !== null) timing.worstFrameGapMs = Math.max(timing.worstFrameGapMs, time-timing.last); timing.last=time; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      timing.observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) timing.worstLongTaskMs = Math.max(timing.worstLongTaskMs,entry.duration); });
      timing.observer.observe({ entryTypes: ['longtask'] });
    }
  };
  state.stopTiming = () => {
    const t=state.timing; t.active=false; t.observer?.disconnect();
    return { startedAt:t.startedAt, stoppedAt:performance.now(), worstFrameGapMs:t.worstFrameGapMs, worstLongTaskMs:t.worstLongTaskMs, worstFrameOrTaskGapMs:Math.max(t.worstFrameGapMs,t.worstLongTaskMs) };
  };
}

export class CdpClient {
  constructor(url) { this.socket = new WebSocket(url); this.pending = new Map(); this.listeners = new Map(); this.id = 0; }
  async open() {
    await new Promise((resolve,reject) => { this.socket.addEventListener('open',resolve,{once:true}); this.socket.addEventListener('error',reject,{once:true}); });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
      } else for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
    return this;
  }
  on(name, listener) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 120000);
      this.pending.set(id,{resolve,reject,timer}); this.socket.send(JSON.stringify({id,method,params}));
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate',{ expression, awaitPromise:true, returnByValue:true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  }
  close() { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('CDP closed')); } this.pending.clear(); this.socket.close(); }
}

async function waitFor(client, expression, label, timeout = 90000) {
  const deadline = Date.now()+timeout;
  while (Date.now()<deadline) { const value=await client.evaluate(expression); if (value) return value; await sleep(150); }
  throw new Error(`Timed out: ${label}`);
}

export async function connectBrowser(url) {
  const targets = await fetch(`http://127.0.0.1:${Number(process.env.CDP_PORT || 9222)}/json/list`).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.url.startsWith(new URL(url).origin));
  requireGate(target, 'No isolated localhost certification browser page.');
  const client = await new CdpClient(target.webSocketDebuggerUrl).open();
  await Promise.all(['Page.enable','Runtime.enable','Network.enable','DOM.enable'].map(method => client.send(method)));
  const {identifier} = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${browserInstrumentation.toString()})()` });
  client.instrumentationId = identifier;
  try {
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.navigate', { url: new URL('editor/',url).href });
    await waitFor(client, 'Boolean(window.__GUI_EDITOR__ && window.__C2)', 'Studio initialization');
    return client;
  } catch(error) { await closeBrowser(client); throw error; }
}

export async function prepareUnchangedC1Page(url) {
  const targets=await fetch(`http://127.0.0.1:${Number(process.env.CDP_PORT||9222)}/json/list`).then(response=>response.json());
  const target=targets.find(item=>item.type==='page' && item.url.startsWith(new URL(url).origin));
  requireGate(target,'No localhost page for unchanged C1.');
  const client=await new CdpClient(target.webSocketDebuggerUrl).open();
  try {
    await client.send('Page.enable'); await client.send('Page.navigate',{url});
    await waitFor(client, 'document.readyState==="complete" && Boolean(document.getElementById("runtime-status"))', 'C1 root application page');
  } finally {client.close();}
}

async function closeBrowser(client) {
  try { await client.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:client.instrumentationId}); }
  finally { client.close(); }
}

export async function openDiskFolder(client, folder) {
  const manifest = JSON.parse(await readFile(path.join(folder,'project.json'),'utf8'));
  const paths = [...new Set(['project.json',...collectDeclaredPackageEntries(manifest).map(entry => entry.path)])];
  await client.evaluate(`(() => { const input=document.createElement('input'); input.type='file'; input.multiple=true; input.id='c2-disk-files'; input.hidden=true; document.body.append(input); return true; })()`);
  const { root } = await client.send('DOM.getDocument');
  const { nodeId } = await client.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#c2-disk-files'});
  await client.send('DOM.setFileInputFiles',{nodeId,files:paths.map(relative => path.join(folder,relative))});
  const opened = await client.evaluate(`(async () => {
    const paths=${JSON.stringify(paths)}, files=Array.from(document.getElementById('c2-disk-files').files);
    if(files.length!==paths.length || files.some((file,index)=>file.name!==paths[index].split('/').at(-1))) throw Error('Disk File input mapping failed');
    const entries=window.__C2.files=new Map(paths.map((p,i)=>[p,files[i]])); window.__C2.writes=[];
    function directory(prefix='') { return {kind:'directory',name:'C2 native Files / test DirectoryHandle',
      async getDirectoryHandle(name) { return directory(prefix+name+'/'); },
      async getFileHandle(name) { const relative=prefix+name,file=entries.get(relative); if(!file)throw new DOMException(relative,'NotFoundError');
        return {kind:'file',name,async getFile(){return file;},async createWritable(){let bytes;return {async write(value){bytes=Array.from(value);},async close(){window.__C2.writes.push({path:relative,bytes});}}}}; }
    }; }
    await window.__GUI_EDITOR__.openFolder(directory());
    return {nativeDiskFiles:files.every(file=>file instanceof File),fileCount:files.length,fullReads:window.__C2.fullReads,status:document.getElementById('validation-status').textContent};
  })()`);
  await waitFor(client, `Boolean(document.getElementById('production-preview').dataset.previewRevision && document.getElementById('production-preview').contentWindow.__C2?.maps.at(-1)?.loaded())`, 'production Folder preview');
  return opened;
}

export async function captureFreezePlan({url,projectDir,planPath}) {
  const client = await connectBrowser(url);
  try {
    await client.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:path.dirname(planPath)});
    const opened = await openDiskFolder(client,projectDir);
    await waitFor(client, '!document.getElementById("prepare-freeze").disabled', 'saved valid Folder Freeze command');
    await client.evaluate('document.getElementById("prepare-freeze").click()');
    await waitFor(client, 'document.getElementById("freeze-dialog").open', 'actual Prepare Freeze dialog', 180000);
    const displayed = await client.evaluate(`({ required:document.getElementById('freeze-required-bounds').textContent, final:['min-lon','min-lat','max-lon','max-lat'].map(id=>Number(document.getElementById('freeze-'+id).value)) })`);
    await client.evaluate('document.getElementById("download-freeze-plan").click()');
    const plan = await waitFor(client, 'window.__C2.downloads.find(plan=>plan.kind==="overture-pmtiles-c2-freeze-plan")', 'production plan download');
    const captures = await client.evaluate('window.__C2.captures');
    // Preserve actual failed dimensions/bounds too; a failed check must not discard evidence.
    await writeFile(`${planPath}.capture.json`,JSON.stringify({opened,displayed,captures,plan},null,2)+'\n');
    verifyCapture(plan,captures);
    requireGate(JSON.stringify(plan.requiredBounds)===JSON.stringify(plan.finalBounds) && JSON.stringify(displayed.final)===JSON.stringify(plan.finalBounds), 'Benchmark plan must not enlarge bounds.');
    await writeFile(planPath, JSON.stringify(plan,null,2)+'\n');
    return { opened, displayed, captures, plan, boundary:'Native disk-backed browser Files via CDP input; test DirectoryHandle facade, not native picker/permission UX.' };
  } catch(error) {
    const failure=await client.evaluate(`({captures:window.__C2?.captures,downloads:window.__C2?.downloads,status:document.getElementById('validation-status')?.textContent,preview:document.getElementById('preview-status')?.textContent})`).catch(()=>null);
    await writeFile(`${planPath}.failure.json`,JSON.stringify({error:error.stack??String(error),failure},null,2)+'\n');
    throw error;
  } finally { await closeBrowser(client); }
}

const inPreview = expression => `(() => { const w=document.getElementById('production-preview').contentWindow, s=w.__C2, m=s.maps.at(-1); return (${expression}); })()`;
const countsExpression = `({maps:s.maps.length,canvases:w.document.querySelectorAll('.maplibregl-canvas').length,protocols:s.protocols,fileSources:s.fileSources,sources:Number(Boolean(m.getSource('${SOURCE}'))),flat:Number(Boolean(m.getLayer('${FLAT}'))),extrusion:Number(Boolean(m.getLayer('${EXTRUSION}'))),sourceAdds:s.sourceAdds,flatAdds:s.flatAdds,extrusionAdds:s.extrusionAdds,sourceRemoves:s.sourceRemoves,layerRemoves:s.layerRemoves})`;
const featuresExpression = `m.getLayer('${EXTRUSION}') ? m.queryRenderedFeatures(undefined,{layers:['${EXTRUSION}']}).length : 0`;

async function setMeasuredViewport(client) {
  await client.evaluate(`(()=>{const frame=document.getElementById('preview-frame');frame.classList.add('is-freeze-capture');frame.style.width='1440px';frame.style.height='900px';return true;})()`);
  const actual=await client.evaluate(inPreview(`(()=>{m.resize();const rect=m.getCanvas().getBoundingClientRect();return{viewport:[w.innerWidth,w.innerHeight],canvas:[rect.width,rect.height]};})()`));
  requireGate(actual.viewport[0]===1440 && actual.viewport[1]===900 && actual.canvas[0]===1440 && actual.canvas[1]===900,'Measured runtime viewport differs from C1 1440x900.');
  return actual;
}

async function measureFps(client) {
  return client.evaluate(inPreview(`(async()=>{const start=w.performance.now();let frames=0;await new Promise(resolve=>{const frame=time=>{frames++;if(time-start>=4000)resolve();else w.requestAnimationFrame(frame);};w.requestAnimationFrame(frame);});const elapsedMs=w.performance.now()-start;return{frames,elapsedMs,averageFps:frames*1000/elapsedMs};})()`));
}

// Separate diagnostics preserve usable same-runner metrics if the unchanged C1 hard gate
// fails before printing its result object. They never convert that failure into PASS.
export async function measureOfficialDiagnostics({url,projectDir}) {
  const client=await connectBrowser(url), records=new Map();
  const result={kind:'same-runner official-source diagnostic, not replacement C1 certification',startedAt:new Date().toISOString()};
  client.on('Network.requestWillBeSent',({requestId,request})=>{if(/overturemaps.*\/tiles\/.+\/buildings\.pmtiles/.test(request.url))records.set(requestId,{url:request.url,range:Object.entries(request.headers).find(([name])=>name.toLowerCase()==='range')?.[1]??null});});
  client.on('Network.responseReceived',({requestId,response})=>{const record=records.get(requestId);if(record){record.status=response.status;record.contentRange=Object.entries(response.headers).find(([name])=>name.toLowerCase()==='content-range')?.[1]??null;}});
  try {
    await openDiskFolder(client,projectDir); result.viewport=await setMeasuredViewport(client);
    result.preActivationRequests=records.size;
    await client.evaluate(inPreview(`(()=>{const next=[...w.document.querySelectorAll('#runtime-navigation button')].find(b=>b.textContent.trim()==='Next');next.click();next.click();next.click();return true;})()`));
    await waitFor(client,inPreview(`/Scene 4 of 7/.test(w.document.getElementById('runtime-status').textContent) && !m.isMoving()`),'official diagnostic pre-activation');
    await client.evaluate(inPreview(`(()=>{s.startTiming();[...w.document.querySelectorAll('#runtime-navigation button')].find(b=>b.textContent.trim()==='Next').click();return true;})()`));
    await waitFor(client,inPreview(`m.getContainer().dataset.urbanContextStatus==='available' && m.isSourceLoaded('${SOURCE}') && (${featuresExpression})>0`),'official diagnostic buildings');
    result.activation=await client.evaluate(inPreview('s.stopTiming()'));
    result.fps=await measureFps(client); result.renderedFeatures=await client.evaluate(inPreview(featuresExpression));
    result.camera=await client.evaluate(inPreview('({center:m.getCenter().toArray(),zoom:m.getZoom(),pitch:m.getPitch(),bearing:m.getBearing()})'));
  } catch(error) {result.error=error.stack??String(error);}
  finally {result.requests=[...records.values()];result.finishedAt=new Date().toISOString();await closeBrowser(client);}
  return result;
}

export async function certifyBrowser({url,snapshot,manifest}) {
  const identity = await verifySnapshot(snapshot,manifest);
  const client = await connectBrowser(url);
  const evidence = { startedAt:new Date().toISOString(), artifact:identity.sha256, snapshotBytes:identity.bytes, phases:[], officialRequests:0,
    browserBoundary:'Native disk-backed Files via CDP; test DirectoryHandle facade. No native picker/permission UX. CI software rendering is not physical-GPU certification.' };
  const network = [];
  const runtimeErrors=[];
  client.on('Runtime.exceptionThrown',({exceptionDetails})=>runtimeErrors.push(exceptionDetails.exception?.description??exceptionDetails.text));
  client.on('Network.requestWillBeSent',({request}) => { if (/overturemaps.*\/tiles\/.+\/buildings\.pmtiles/.test(request.url)) { evidence.officialRequests++; network.push(request.url); } });
  try {
    evidence.folder = await openDiskFolder(client,path.dirname(manifest));
    evidence.viewport = await setMeasuredViewport(client);
    evidence.renderer = await client.evaluate(inPreview(`(()=>{const gl=m.getCanvas().getContext('webgl2')??m.getCanvas().getContext('webgl');const extension=gl?.getExtension('WEBGL_debug_renderer_info');return{renderer:gl?.getParameter(gl.RENDERER),unmaskedRenderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):null};})()`));
    evidence.before = await client.evaluate(inPreview(`({fullReads:s.fullReads+parent.__C2.fullReads,slices:s.slices+parent.__C2.slices,protocols:s.protocols,sources:Number(Boolean(m.getSource('${SOURCE}')))})`));
    await client.evaluate(inPreview(`(()=>{const next=[...w.document.querySelectorAll('#runtime-navigation button')].find(b=>b.textContent.trim()==='Next'); next.click();next.click();next.click();return true;})()`));
    await waitFor(client,inPreview(`/Scene 4 of 7/.test(w.document.getElementById('runtime-status').textContent) && !m.isMoving()`),'pre-activation Scene');
    await client.evaluate(inPreview(`(()=>{s.startTiming();[...w.document.querySelectorAll('#runtime-navigation button')].find(b=>b.textContent.trim()==='Next').click();return true;})()`));
    await waitFor(client,inPreview(`m.getContainer().dataset.urbanContextStatus==='available' && m.isSourceLoaded('${SOURCE}') && (${featuresExpression})>0`),'rendered frozen buildings');
    evidence.activation = await client.evaluate(inPreview('s.stopTiming()'));
    evidence.activation.attribution = 'Observed full first-activation window, including production camera/basemap work; not isolated PMTiles CPU time.';
    evidence.firstActivation = await client.evaluate(inPreview('({fullReads:s.fullReads+parent.__C2.fullReads,slices:s.slices,bytes:s.bytes})'));
    evidence.renderedFeatures = await client.evaluate(inPreview(featuresExpression));
    evidence.countsBefore = await client.evaluate(inPreview(countsExpression));
    const camera = await client.evaluate(inPreview('({center:m.getCenter().toArray(),zoom:m.getZoom(),pitch:m.getPitch(),bearing:m.getBearing(),bounds:m.getBounds().toArray()})'));
    const move = async camera => {
      await client.evaluate(inPreview(`m.jumpTo(${JSON.stringify(camera)}) && true`));
      await waitFor(client,inPreview(`!m.isMoving() && m.isSourceLoaded('${SOURCE}')`),'settled camera');
      await sleep(200);
    };
    // Rotation occurs on the actual loaded map; all add/remove counters remain live.
    for(let bearing=0;bearing<=360;bearing+=30) await move({bearing});
    evidence.phases.push('bearing-360');
    for(const pitch of [0,camera.pitch,0]) await move({pitch});
    evidence.phases.push('pitch-0-target-0');
    const bounds=identity.bounds, pan=[camera.center[0]+(bounds[2]-bounds[0])*0.03,camera.center[1]];
    requireGate(pan[0]>bounds[0] && pan[0]<bounds[2] && pan[1]>bounds[1] && pan[1]<bounds[3], 'Bounded pan target outside snapshot.');
    await move({center:pan}); await move(camera); evidence.phases.push('pan-away-back');
    await client.evaluate(inPreview(`(()=>{[...w.document.querySelectorAll('#runtime-navigation button')].find(b=>b.textContent.trim()==='Next').click();return true;})()`));
    await waitFor(client,inPreview(`/Scene 6 of 7/.test(w.document.getElementById('runtime-status').textContent) && !m.isMoving()`),'Scene B');
    const sceneB = await client.evaluate(inPreview('({bounds:m.getBounds().toArray(),context:m.getContainer().dataset.urbanContext})'));
    const inside = sceneB.bounds[0][0]>=bounds[0] && sceneB.bounds[0][1]>=bounds[1] && sceneB.bounds[1][0]<=bounds[2] && sceneB.bounds[1][1]<=bounds[3];
    await client.evaluate(inPreview(`(()=>{[...w.document.querySelectorAll('#runtime-navigation button')].find(b=>b.textContent.trim()==='Previous').click();return true;})()`));
    await waitFor(client,inPreview(`!m.isMoving() && (${featuresExpression})>0`),'return to Scene A');
    evidence.sceneReuse = { status:inside?'PASS':'NOT_APPLICABLE_OUTSIDE_SNAPSHOT', sceneB, navigationABA:'completed', reason:inside?'Both tested cameras are inside the frozen extent.':'Actual Scene B bounds exceed the frozen extent; bounded dual-camera rendering is not claimed.' };
    evidence.fps = await measureFps(client);
    evidence.countsAfter = await client.evaluate(inPreview(countsExpression));
    evidence.readsAfterSweeps = await client.evaluate(inPreview('({slices:s.slices,bytes:s.bytes,fullReads:s.fullReads})'));
    evidence.errors = [...await client.evaluate(inPreview('s.errors')),...runtimeErrors];
    evidence.camera = camera;
    const {data} = await client.send('Page.captureScreenshot',{format:'png',fromSurface:true});
    await writeFile(path.resolve('c2-browser.png'),Buffer.from(data,'base64'));

    // Unrelated production Save runs through the real adapter, then its bounded write intents
    // are applied to this temporary smoke Folder. Snapshot bytes are never sent through CDP.
    const beforeStat=await stat(snapshot), beforeHash=await hashFile(snapshot);
    await client.evaluate(`(()=>{const input=document.getElementById('project-locale');input.value=input.value==='en-US'?'vi-VN':'en-US';input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('validate-project').click();return true;})()`);
    await waitFor(client, 'document.getElementById("validity-status").textContent==="Valid"', 'unrelated draft validation');
    const save=await client.evaluate('window.__GUI_EDITOR__.save()');
    const writes=await client.evaluate('window.__C2.writes');
    requireGate(writes.length===1 && writes[0].path==='project.json','Unrelated Save wrote unexpected files.');
    await writeFile(manifest,Buffer.from(writes[0].bytes));
    evidence.save={result:save,written:writes.map(w=>w.path),snapshotHashBefore:beforeHash,snapshotHashAfter:await hashFile(snapshot),mtimeBefore:beforeStat.mtimeMs,mtimeAfter:(await stat(snapshot)).mtimeMs};
    requireGate(evidence.save.snapshotHashBefore===evidence.save.snapshotHashAfter && evidence.save.mtimeBefore===evidence.save.mtimeAfter,'Save changed snapshot.');
    evidence.zip=await client.evaluate(`(async()=>{
      const bytes=await window.__GUI_EDITOR__.exportZip();
      const {createZipStorageAdapter}=await import('/editor/storage/adapters.js');
      const opened=await createZipStorageAdapter({zipBytes:bytes}).open();
      const snapshot=opened.entries.find(e=>e.mediaType==='application/vnd.pmtiles');
      const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',snapshot.bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      await window.__GUI_EDITOR__.importZip(bytes);
      return{zipBytes:bytes.length,snapshotBytes:snapshot.bytes.length,sha256,status:document.getElementById('validation-status').textContent};
    })()`);
    requireGate(evidence.zip.sha256===identity.sha256 && evidence.zip.snapshotBytes===identity.bytes,'ZIP changed snapshot bytes.');
    evidence.assessment=assessBrowserEvidence(evidence);
    return evidence;
  } catch(error) {
    evidence.error=error.stack ?? String(error);
    evidence.assessment=assessBrowserEvidence(evidence);
    return evidence;
  } finally {
    evidence.finishedAt=new Date().toISOString(); evidence.officialRequestUrls=network; await closeBrowser(client);
  }
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const evidence=await certifyBrowser(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(evidence,null,2));
    if(evidence.error || evidence.assessment.functional!=='PASS' || evidence.assessment.performance!=='PASS') process.exitCode=1;
  } catch(error) { console.error(error.stack ?? error); process.exitCode=1; }
}
