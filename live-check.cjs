const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const evidence = 'C:/Users/Vokupt/.no-mistakes/evidence/01M2VP7VGHVYSMA5RYAJWB1T2R';
fs.mkdirSync(evidence,{recursive:true});
const delay = ms => new Promise(r=>setTimeout(r,ms));
const records=[];
const record=(name,value)=>{records.push({name,value});fs.writeFileSync(path.join(evidence,'live-results.json'),JSON.stringify(records,null,2));console.log(name,JSON.stringify(value));};
async function connect(url){
 const ws=new WebSocket(url);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 let id=0;const pending=new Map();const events=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result)}else events.push(m)};
 return {events,close:()=>ws.close(),send:(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}))})};
}
async function evaluate(c,expression){const r=await c.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
let browser;
async function launch(){
 const proc=spawn(process.env.LOCALAPPDATA+'/ms-playwright/chromium-1234/chrome-win64/chrome.exe',[
 '--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=19387',
 '--user-data-dir='+path.join(process.cwd(),'.live-profile'),'--disable-extensions-except='+process.cwd(),'--load-extension='+process.cwd(),'about:blank'
 ],{windowsHide:true,stdio:'ignore'});
 for(let i=0;i<60;i++){try{const v=await(await fetch('http://127.0.0.1:19387/json/version')).json();browser=await connect(v.webSocketDebuggerUrl);return proc}catch{await delay(250)}}throw Error('Chromium debugging endpoint unavailable');
}
async function targets(){return (await browser.send('Target.getTargets')).targetInfos;}
async function page(url){const {targetId}=await browser.send('Target.createTarget',{url});await delay(1500);const list=await(await fetch('http://127.0.0.1:19387/json')).json();return connect(list.find(t=>t.id===targetId).webSocketDebuggerUrl);}
async function shot(c,name){const {data}=await c.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,name),Buffer.from(data,'base64'));}
(async()=>{
 await launch();await delay(1200);
 const sw=(await targets()).find(t=>t.type==='service_worker'&&t.url.includes('background/background.js'));
 assert.ok(sw,'unpacked extension service worker');const extension=sw.url.split('/')[2];record('extension loaded',{extension,url:sw.url});
 const popup=await page('chrome-extension://'+extension+'/popup/popup.html');
 await popup.send('Emulation.setDeviceMetricsOverride',{width:420,height:700,deviceScaleFactor:1,mobile:false});
 record('popup initial',await evaluate(popup,`({text:document.body.innerText,inputs:[...document.querySelectorAll('input')].map(x=>({id:x.id,type:x.type,min:x.min,max:x.max,value:x.value}))})`));
 await shot(popup,'popup.png');
 assert.equal(await evaluate(popup,`document.querySelector('#fontSizeScale').min`),'0.8');
 assert.equal(await evaluate(popup,`document.querySelector('#overlayBottom').max`),'120');
 await evaluate(popup,`document.querySelector('#targetLang').value='ja';document.querySelector('#targetLang').dispatchEvent(new Event('change'));document.querySelector('#overlayBottom').value='10';document.querySelector('#overlayBottom').dispatchEvent(new Event('input'))`);
 await delay(200);await popup.send('Page.reload');await delay(400);
 const settings=await evaluate(popup,`({lang:document.querySelector('#targetLang').value,bottom:document.querySelector('#overlayBottom').value})`);assert.deepEqual(settings,{lang:'ja',bottom:'10'});record('popup persisted settings',settings);
 await evaluate(popup,`chrome.storage.sync.set({targetLang:'vi',overlayBottom:55,transcriptOpen:true})`);
 const list=await(await fetch('http://127.0.0.1:19387/json')).json();const worker=await connect(list.find(t=>t.type==='service_worker').webSocketDebuggerUrl);await worker.send('Network.enable');
 await worker.send('Runtime.enable');await evaluate(worker,'translationCache.cache.clear();chrome.storage.local.clear()');await delay(500);
 const result=await evaluate(popup,`Promise.all(Array.from({length:8},()=>chrome.runtime.sendMessage({action:'translate',text:'Good morning, welcome to this lesson.',targetLang:'vi'})))`);
 assert.ok(result.every(r=>r.translatedText&&!r.isFallback&&r.detectedLang==='en'));
 record('eight concurrent real translations',result);
 await delay(500);const requests=worker.events.filter(e=>e.method==='Network.requestWillBeSent').map(e=>e.params.request.url);record('translation network requests',requests);record('dedupe network observation',{count:requests.filter(u=>u.includes('translate_a/single')).length});
 record('persistent cache',await evaluate(popup,'chrome.storage.local.get(null)'));
 await worker.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 const failed=await evaluate(popup,`chrome.runtime.sendMessage({action:'translate',text:'A temporary network interruption can be retried.',targetLang:'vi'})`);assert.equal(failed.isFallback,true);record('offline fallback',failed);
 const cache=await evaluate(popup,'chrome.storage.local.get(null)');assert.ok(!Object.keys(cache).some(k=>k.includes('temporary network')));
 await worker.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 const retry=await evaluate(popup,`chrome.runtime.sendMessage({action:'translate',text:'A temporary network interruption can be retried.',targetLang:'vi'})`);assert.ok(!retry.isFallback);record('network recovered retry',retry);
 const yt=await page('https://www.youtube.com/watch?v=jNQXAC9IVRw');await delay(10000);record('YouTube state',await evaluate(yt,`({url:location.href,title:document.title,text:document.body.innerText.slice(0,7000),panel:!!document.querySelector('#ybs-transcript-panel'),video:!!document.querySelector('video')})`));await shot(yt,'youtube.png');
 await yt.send('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false});
 record('CC initial',await evaluate(yt,`({cc:document.querySelector('.ytp-subtitles-button')?.outerHTML})`));
 await evaluate(yt,`(()=>{const cc=document.querySelector('.ytp-subtitles-button');if(cc?.getAttribute('aria-pressed')==='false')cc.click();const v=document.querySelector('video');v.currentTime=0;v.play();})()`);
 await delay(7000);
 await evaluate(yt,`document.querySelector('video').pause()`);
 record('captured live captions',await evaluate(yt,`({rows:[...document.querySelectorAll('.ybs-row')].map(x=>x.innerText),panel:document.querySelector('#ybs-transcript-panel')?.innerText,captions:[...document.querySelectorAll('.ytp-caption-segment')].map(x=>x.innerText)})`));await shot(yt,'captions.png');
 await evaluate(yt,`document.querySelector('.ybs-primary').click()`);await delay(4000);
 record('Translate All live',await evaluate(yt,`document.querySelector('#ybs-transcript-panel')?.innerText`));
 await evaluate(popup,`chrome.storage.sync.set({targetLang:'ja'})`);await delay(300);await evaluate(yt,`document.querySelector('.ybs-primary').click()`);await delay(4000);
 record('Translate All after language change',await evaluate(yt,`document.querySelector('#ybs-transcript-panel')?.innerText`));await shot(yt,'transcript-japanese.png');
 await browser.send('Browser.close').catch(()=>{});await delay(1600);
 await launch();await delay(1000);
 const p2=await page('chrome-extension://'+extension+'/popup/popup.html');const r2=await evaluate(p2,`chrome.runtime.sendMessage({action:'translate',text:'Good morning, welcome to this lesson.',targetLang:'vi'})`);assert.deepEqual(r2,result[0]);record('browser restart preserves translation metadata',r2);
 await browser.send('Browser.close').catch(()=>{});
})().catch(async e=>{record('driver error',e.stack);await browser?.send('Browser.close').catch(()=>{});process.exitCode=1});
