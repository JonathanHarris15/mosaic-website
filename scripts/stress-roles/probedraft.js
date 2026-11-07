const G = require('./gen.js');
/** @typedef {import('./gen.js').Role} Role */
/** @typedef {import('./gen.js').CandidatesFor} CandidatesFor */
const n = Number(process.argv[2]||5000);
const mode = process.argv[3]||'noSame';
const budget = Number(process.argv[4]||120000);
const c = G.church({ n, seed: 42, crossSame: mode==='crossSame', unfillable: mode==='unfillable' });
if (mode==='noSame') c.roles = c.roles.filter(r => !r.restrictions.some(x => x.kind === 'sameGroup'));
let calls=0, perRole=/** @type {Object<string, number>} */ ({}), perDate=/** @type {Object<string, { ms: number, widened: number, unfilled: number }>} */ ({}); let cur=null; const deadline=Date.now()+budget;
/** @type {CandidatesFor} */
const cf = (def, slot, ctx) => { if (Date.now()>deadline) throw new Error('DEADLINE'); calls++; perRole[def.slug]=(perRole[def.slug]||0)+1; return G.Roles.candidatesFor(def, slot, ctx); };
/** @param {{ date: string }} o */
const solve = o => { cur=o.date; const t=Date.now(); const r=G.Fairness.solve(o); perDate[o.date]={ms:Date.now()-t,widened:r.widened,unfilled:r.unfilled.length}; return r; };
const t=Date.now();
try { G.AutoAssign.draft(G.draftOptions(c, { solve, candidatesFor: cf })); console.log('done', Date.now()-t); }
catch(e){ console.log('aborted on', cur, /** @type {Error} */ (e).message, Date.now()-t); }
console.log(JSON.stringify(perDate));
console.log('calls', calls, Object.entries(perRole).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([s,k])=>{const d=/** @type {Role} */ (c.roles.find(r=>r.slug===s));return s+' calls='+k+' slots='+JSON.stringify(d.slots.map(x=>x.requirement))+' '+JSON.stringify(d.restrictions).slice(0,90);}).join('\n'));
