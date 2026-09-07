// Focused rendering and interaction smoke check for the independent prototype.
// Runs in a hidden Electron window, with no preload and no production engine.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

app.commandLine.appendSwitch('disable-gpu');
const output = path.join(__dirname, 'verification');
const failures = [];
const checks = [];
let win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function check(name, fn) {
  try { await fn(); checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}
async function click(selector) {
  await evaluate(selector => {
    const target = document.querySelector(selector);
    if (!target) throw new Error(`Missing control: ${selector}`);
    target.click();
  }, selector);
  await pause(60);
}
async function route(id) { await evaluate(id => { location.hash = id; }, id); await pause(90); }
async function screenshot(name) {
  await pause(140);
  fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
}
const routes = ['groundstation','workspace','needs','agents','recipes','history','settings','ai','integrations','projects'];

app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  win = new BrowserWindow({ width:1440, height:1000, show:false, webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,partition:'obsidian-check',offscreen:true} });
  const consoleErrors = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2 && !message.includes('Electron Security Warning')) consoleErrors.push(message);
  });
  await win.loadFile(path.join(__dirname,'index.html'));
  await pause(200);
  await evaluate(() => { localStorage.clear(); location.reload(); });
  await pause(300);
  await check('Groundstation renders local fonts and icons',async () => {
    assert.equal(await evaluate(()=>document.querySelector('h1')?.textContent),'Groundstation');
    assert.ok(await evaluate(()=>document.querySelectorAll('svg.lucide').length > 20));
    await evaluate(()=>document.fonts.ready.then(()=>true));
    assert.equal(await evaluate(()=>document.fonts.check('14px Inter')),true);
  });
  await screenshot('groundstation-desktop.png');
  for (const id of routes) {
    await check(`Route: ${id}`,async()=>{
      await route(id);
      assert.equal(await evaluate(()=>document.querySelectorAll('main h1').length),1);
      assert.ok(await evaluate(()=>document.querySelector('main').textContent.length>100));
      const unnamed=await evaluate(()=>[...document.querySelectorAll('button,input,textarea,select')].filter(el=>el.getClientRects().length && !(el.textContent.trim()||el.getAttribute('aria-label')||el.labels?.length)).map(el=>el.outerHTML.slice(0,150)));
      assert.deepEqual(unnamed,[]);
      assert.equal(await evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),true);
    });
    if(['workspace','needs','ai','settings','integrations'].includes(id)) await screenshot(`${id}-desktop.png`);
  }
  await check('Worker search and empty result recovery',async()=>{
    await route('groundstation');
    await evaluate(()=>{const input=document.querySelector('#worker-search');input.value='zz-no-match';input.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.ok(await evaluate(()=>document.querySelector('#worker-rows').textContent.includes('No workers match')));
    await click('[data-action="clear-workers"]');
    assert.equal(await evaluate(()=>document.querySelectorAll('#worker-rows tr').length),6);
  });
  await check('Create worker updates the register',async()=>{
    await click('[data-action="add-worker"]');
    await evaluate(()=>{document.querySelector('#worker-name').value='Verification worker';document.querySelector('#worker-form').requestSubmit();});
    assert.equal(await evaluate(()=>document.querySelector('#modal').open),false);
    assert.ok(await evaluate(()=>document.querySelector('#worker-rows').textContent.includes('Verification worker')));
  });
  await check('Acknowledgement leaves failure open, successful retry resolves it',async()=>{
    await route('needs');
    await click('[data-action="acknowledge"]');
    assert.ok(await evaluate(()=>document.querySelector('.inbox-detail').textContent.includes('still unresolved')));
    await click('.inbox-detail [data-action="inspect"]');
    await click('[data-action="worker-lifecycle"]');
    await pause(1050);
    const snapshot=await evaluate(()=>JSON.parse(localStorage.getItem('mission-control.obsidian.prototype.v1')).state);
    assert.equal(snapshot.decisions.find(d=>d.worker==='tests').status,'resolved');
    assert.equal(snapshot.workers.find(w=>w.id==='tests').state,'idle');
  });
  await check('Approval requires explicit confirmation',async()=>{
    await route('needs');
    await click('[data-action="approve"]');
    assert.equal(await evaluate(()=>document.querySelector('#modal').open),true);
    await click('[data-action="confirm-approve"]');
    assert.ok(await evaluate(()=>document.querySelector('main').textContent.includes('all caught up')));
  });
  await check('Recipe editor validates steps and saves',async()=>{
    await route('recipes');
    await click('[data-action="create-recipe"]');
    await evaluate(()=>document.querySelector('#recipe-form').requestSubmit());
    assert.ok(await evaluate(()=>document.querySelector('#recipe-error').textContent.includes('at least one')));
    await evaluate(()=>{document.querySelector('#recipe-name').value='Smoke recipe';document.querySelector('#recipe-steps input').checked=true;document.querySelector('#recipe-form').requestSubmit();});
    await pause(90);
    assert.ok(await evaluate(()=>document.querySelector('main').textContent.includes('Smoke recipe')));
  });
  await check('Simulated terminal accepts pwd without execution',async()=>{
    await route('workspace');
    await evaluate(()=>{const f=document.querySelector('[data-form="terminal"]');f.querySelector('input').value='pwd';f.requestSubmit();});
    assert.ok(await evaluate(()=>document.querySelector('.terminal-body').textContent.includes('D:/Projects/mission-control')));
  });
  await check('AI question yields labelled scripted response',async()=>{
    await route('ai');
    await click('[data-action="ask-preset"][data-id="1"]');
    assert.ok(await evaluate(()=>document.querySelector('.message-assistant').textContent.includes('SCRIPTED DEMO RESPONSE')));
    assert.ok(await evaluate(()=>document.querySelector('.message-assistant').textContent.includes('401')));
  });
  await check('Vercel dark system is locked and operational state is distinguished',async()=>{
    await route('settings');
    assert.equal(await evaluate(()=>document.body.dataset.material),'solid');
    assert.equal(await evaluate(()=>document.querySelector('[data-action="material"]')),null);
    assert.deepEqual(await evaluate(()=>{
      const body = getComputedStyle(document.body);
      const primary = getComputedStyle(document.querySelector('.btn.primary'));
      const live = document.createElement('span'); live.className = 'pill connected';
      const failed = document.createElement('span'); failed.className = 'pill failed';
      document.body.append(live, failed);
      const result = { background: body.backgroundColor, primary: primary.backgroundColor, primaryText: primary.color, live: getComputedStyle(live).color, failed: getComputedStyle(failed).color };
      live.remove(); failed.remove();
      return result;
    }),{ background: 'rgb(0, 0, 0)', primary: 'rgb(0, 112, 243)', primaryText: 'rgb(255, 255, 255)', live: 'rgb(50, 213, 131)', failed: 'rgb(255, 95, 95)' });
    await evaluate(()=>{localStorage.removeItem('mission-control.obsidian.prototype.v1');location.hash='groundstation';location.reload();});await pause(250);
    assert.ok(await evaluate(()=>document.querySelector('.worker-row--running')));
    assert.ok(await evaluate(()=>document.querySelector('.worker-row--failed')));
    assert.ok(await evaluate(()=>document.querySelector('.decision-preview:has(h3.red)')));
    await screenshot('groundstation-vercel-dark.png');
    await evaluate(()=>location.reload());await pause(250);
    assert.equal(await evaluate(()=>document.body.dataset.material),'solid');
  });
  await check('Palette works with input and keyboard',async()=>{
    await click('[data-action="palette"]');
    await evaluate(()=>{const el=document.querySelector('#palette-input');el.value='recipes';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));});
    assert.equal(await evaluate(()=>document.activeElement.className),'palette-result');
    await click('.palette-result');
    assert.equal(await evaluate(()=>location.hash),'#recipes');
  });
  for(const width of [960,720,390,320]){
    await check(`All routes reflow at ${width}px`,async()=>{
      win.setSize(width,960);await pause(100);
      const overflows=[];
      for(const id of routes){await route(id);if(!await evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)){
        overflows.push(id);
        console.log('Overflow details',id,JSON.stringify(await evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('main *')].filter(el=>el.getBoundingClientRect().right>innerWidth).slice(0,8).map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right}))}))));
      }}
      assert.deepEqual(overflows,[]);
    });
    if(width===390){await route('groundstation');await screenshot('groundstation-mobile.png');}
  }
  await check('No renderer errors or unresolved icon names',async()=>assert.deepEqual(consoleErrors,[]));
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({date:new Date().toISOString(),checks,consoleErrors,limitations:['No screen-reader or real-device test','No production services or process execution','No formal WCAG conformance claim']},null,2));
  console.log(`${checks.filter(c=>c.passed).length}/${checks.length} checks passed`);
  win.destroy();app.exit(failures.length?1:0);
}).catch(error=>{console.error(error);app.exit(1);});
