// candidatesFor + one solve per size, with a deadline on the solve (no draft).
const G = require('./gen.js'); const { Roles, Fairness } = G;
/** @typedef {import('./gen.js').Role} Role */
/** @typedef {import('./gen.js').CandidatesFor} CandidatesFor */
const mode = process.argv[2] || 'clean';
/** @param {number[]} xs */
const median = xs => xs.slice().sort((a,b)=>a-b)[Math.floor(xs.length/2)];
/**
 * @param {() => unknown} fn
 * @param {number} k
 */
const tm = (fn,k)=>{const t=[];for(let i=0;i<k;i++){const s=process.hrtime.bigint();fn();t.push(Number(process.hrtime.bigint()-s)/1e6);}return median(t);};
for (const n of [200,1000,5000,10000]) {
  const c = G.church({ n, seed: 42 });
  if (mode==='noSame') c.roles = c.roles.filter(r => !r.restrictions.some(x => x.kind === 'sameGroup'));
  const elsewhere = c.people.slice(10,70).map((p,i)=>({personId:p.id, roleSlug:'role'+(i%30), allowsAnotherRole:false}));
  const base = { people:c.people, relationships:c.relationships, groups:c.groups, assigned:[{slotId:'s1',personId:'p5'}], assignedElsewhere:elsewhere, crossRoleRules:c.crossRoleRules, awayPersonIds:c.awayByDate[c.dates[0]] };
  const s9 = {id:'s9', requirement:'either'};
  /** @type {Object<string, number | string>} */
  const row = { n };
  for (const slug of ['role0','role1','role3','role4','role6']) {
    const d = /** @type {Role} */ (c.roles.find(r=>r.slug===slug) || G.church({n:10,seed:42}).roles.find(r=>r.slug===slug));
    row[slug+':'+(d.restrictions.map(x=>x.kind).join('+')||'none')] = +tm(()=>Roles.candidatesFor(d, s9, base), 5).toFixed(2);
  }
  const deadline = Date.now()+90000; let calls=0;
  /** @type {CandidatesFor} */
  const cf=(d,s,x)=>{ if(Date.now()>deadline) throw new Error('>90s'); calls++; return Roles.candidatesFor(d,s,x); };
  const t=Date.now();
  try { const r=Fairness.solve(G.solveOptions(c,null,{candidatesFor:cf})); row.solve_ms=Date.now()-t; row.widened=r.widened; row.unfilled=r.unfilled.length; }
  catch(e){ row.solve_ms='>90000'; }
  row.calls=calls;
  console.log(JSON.stringify(row));
}
