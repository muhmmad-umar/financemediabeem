/* End-to-end check of the Allah's Share credit display (dashboard + Allah's Share page).
   Needs the local stack running:  npm run dev  (API :8787)  +  npm run dev:web  (site :8080), a seeded admin
   (ADMIN_EMAIL=admin@mediabeem.test ADMIN_PASSWORD='TestPassw0rd!x' npm run db:seed:local) and `npm i -D playwright`.
   Part A: payments above what is owed → credit shows.  Part B: a credit of ₨5,000 is written straight into the local
   database (app_settings.allah_share_credit), must show on both screens, survives a reload, then is removed again. */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const B='http://localhost:8787';
const jf = async (path, tok, body, method='POST') => (await fetch(B+path,{method,headers:{'Content-Type':'application/json',...(tok?{Authorization:'Bearer '+tok}:{})},body:body?JSON.stringify(body):undefined})).json();
const at = (await jf('/api/auth/login',null,{email:'admin@mediabeem.test',password:'TestPassw0rd!x'})).token;
const d = n => { const x=new Date(); x.setDate(x.getDate()-n); return x.toISOString().slice(0,10); };
const sql = q => execSync(`npx wrangler d1 execute mediabeem-db --local -c worker/wrangler.toml --command "${q}" 2>&1 | grep -c '"success": true'`).toString().trim();
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs=[]; const ctx = await b.newContext({ viewport:{width:1400,height:1000} }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
let first = true;
const open = async () => { if (first) { first = false; await p.goto('http://localhost:8080/login'); await p.fill('#email','admin@mediabeem.test'); await p.fill('#pw','TestPassw0rd!x'); await p.click('#go'); await p.waitForURL('**/admin',{waitUntil:'commit'}); } else { await p.goto('http://localhost:8080/admin'); } await p.waitForSelector('#syncStat'); await p.waitForTimeout(1800); await p.evaluate(()=>{ period.mode='all'; render(); }); await p.waitForTimeout(300); };
const dash = () => p.evaluate(()=>({card:(document.getElementById('dashAllah')||{}).innerText?.replace(/\s+/g,' '), banner:[...document.querySelectorAll('.credit-ahead')].map(x=>x.textContent.trim())}));
const panel = async () => { await p.click('#nav button[data-view="allah"]'); await p.waitForTimeout(400); return p.evaluate(()=>({rows:[...document.querySelectorAll('.card.tracker .trk-row')].map(r=>r.innerText.replace(/\s+/g,' ').trim()), banner:[...document.querySelectorAll('.card.tracker .credit-ahead')].map(x=>x.textContent.trim()), creditRow:!!document.getElementById('creditRow')})); };
// ---------- A: data shaped like the live site (obligated payments exceed what is owed)
await jf('/api/admin/sync',at,{settings:{data_version:'4',cu_migrated:'1',cu_nofolders:'1'}});
await jf('/api/admin/sync',at,{key:'invoices',upserts:[{id:'i1',client:'A',service:'Jobs',category:'Services',date:d(5),total_amount:250000,payments:[{id:'p1',amount:250000,date:d(5),note:''}]}]});
await jf('/api/admin/sync',at,{key:'expenses',upserts:[{id:'x1',date:d(4),category:'Other',description:'costs',amount:64500}]});
await jf('/api/admin/sync',at,{key:'charity_expenses',upserts:[{id:'c1',type:'obligated',amount:3750,date:d(3),cause:'Relative',notes:''},{id:'c2',type:'voluntary',amount:6250,date:d(4),cause:'Relative',notes:''},{id:'c3',type:'obligated',amount:17000,date:d(0),cause:'Milad',notes:''}]});
await open();
console.log('A dashboard :', JSON.stringify(await dash()));
console.log('A allah page:', JSON.stringify(await panel()));
await p.screenshot({ path:'/tmp/t/cr2_A_panel.png' });
await p.click('#nav button[data-view="dashboard"]'); await p.waitForTimeout(400); await p.screenshot({ path:'/tmp/t/cr2_A_dash.png' });
// ---------- B: manual value straight in the database on a clean ledger
await jf('/api/admin/sync',at,{key:'charity_expenses',deletes:['c1','c2','c3']}); await jf('/api/admin/sync',at,{key:'invoices',deletes:['i1']}); await jf('/api/admin/sync',at,{key:'expenses',deletes:['x1']});
await p.waitForTimeout(500);
await open(); console.log('B0 clean     :', JSON.stringify(await dash()));
console.log('SQL set 5000 ->', sql("UPDATE app_settings SET value='5000' WHERE key='allah_share_credit'"));
await open();
console.log('B1 DB=5000   dashboard:', JSON.stringify(await dash()));
console.log('B1 DB=5000   allah page:', JSON.stringify(await panel()));
await p.screenshot({ path:'/tmp/t/cr2_B_panel.png' });
await p.click('#nav button[data-view="dashboard"]'); await p.waitForTimeout(400); await p.screenshot({ path:'/tmp/t/cr2_B_dash.png' });
await p.waitForTimeout(1500);
console.log('after app save, settings in DB:', execSync(`npx wrangler d1 execute mediabeem-db --local -c worker/wrangler.toml --command "SELECT key,value FROM app_settings WHERE key LIKE 'allah%'" 2>&1 | grep -E '"key"|"value"' | tr -d ' \\n'`).toString());
// reload again → stays 5000 (no double counting)
await open(); console.log('B2 reload    :', JSON.stringify((await dash()).card));
// remove the test value
console.log('SQL reset 0  ->', sql("UPDATE app_settings SET value='0' WHERE key='allah_share_credit'"));
await open(); console.log('B3 DB=0      :', JSON.stringify(await dash()), '| panel creditRow present:', (await panel()).creditRow);
console.log(errs.join('|')||'no errors'); await b.close();
