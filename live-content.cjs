const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const evidence = 'C:/Users/Vokupt/.no-mistakes/evidence/01M2VP7VGHVYSMA5RYAJWB1T2R';
fs.mkdirSync(evidence,{recursive:true});
const delay = ms => new Promise(r=>setTimeout(r,ms));
const records=[];
const record=(name,value)=>{records.push({name,value});fs.writeFileSync(path.join(evidence,'content-results.json'),JSON.stringify(records,null,2));console.log(name,JSON.stringify(value));};
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
const t=await(await fetch('http://127.0.0.1:19387/json')).json();
const yt=await connect(t.find(x=>x.type==='page'&&x.url.includes('youtube.com')).webSocketDebuggerUrl);
await yt.send('Page.navigate',{url:'https://www.youtube.com/watch?v=H14bBuluwB8'});await delay(12000);
record('CC initial',await evaluate(yt,"({title:document.title,cc:document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-label'),rows:document.querySelectorAll('.ybs-row').length})"));
await evaluate(yt,"(()=>{const cc=document.querySelector('.ytp-subtitles-button');if(cc?.getAttribute('aria-pressed')==='false')cc.click();const v=document.querySelector('video');v.currentTime=0;v.play();})()");
await delay(7000);await evaluate(yt,"document.querySelector('video').pause()");
record('captured captions',await evaluate(yt,"({rows:[...document.querySelectorAll('.ybs-row')].map(x=>x.innerText),caption:[...document.querySelectorAll('.ytp-caption-segment')].map(x=>x.innerText),panel:document.querySelector('#ybs-transcript-panel')?.innerText})"));
yt.close();
})().catch(e=>{record('error',e.stack);process.exit(1)});
