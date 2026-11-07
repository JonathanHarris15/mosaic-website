// Repro: a Role that can only be PARTLY filled makes solve exhaustive and then widen to the whole church.
// e.g. "Communion" allowlist of 5 named people but 6 slots, in a church of N.
const G = require('./gen.js'); const { Roles, Fairness } = G;
/** @typedef {import('./gen.js').CandidatesFor} CandidatesFor */
const PAST = ['2026-10-25','2026-10-18','2026-10-11','2026-10-04','2026-09-27','2026-09-20','2026-09-13','2026-09-06','2026-08-30','2026-08-23','2026-08-16','2026-08-09'];
for (const n of [100, 200, 400, 800]) for (const [allow, slots] of [[3,4],[5,6]]) {
  const people = Array.from({length:n},(_,i)=>({id:'p'+i, name:'p'+i, sex:'male', tags:[], membership:{}}));
  const def = { slug:'communion', name:'Communion', family:'servant', intensity:1,
    restrictions:[{kind:'allowlist', personIds: people.slice(n-allow).map(p=>p.id)}],
    slots: Array.from({length:slots},(_,i)=>({id:'s'+(i+1), requirement:'either'})) };
  let calls=0; const deadline=Date.now()+20000;
  /** @type {CandidatesFor} */
  const cf=(d,s,x)=>{ if(Date.now()>deadline) throw new Error('>20s'); calls++; return Roles.candidatesFor(d,s,x); };
  const t=Date.now();
  try { const r = Fairness.solve({ seriesId:'s', date:'2026-11-01', roles:[def], people, history:[], occurrenceDates:PAST, windowSize:12,
      intensityOf:()=>1, liturgicalSlugs:[], liturgicalHolders:[], relationships:[], groups:[], candidatesFor:cf });
    console.log('n',n,'allow',allow,'slots',slots,'ms',Date.now()-t,'calls',calls,'filled',r.filled.length,'widened',r.widened);
  } catch(e){ console.log('n',n,'allow',allow,'slots',slots,'ABORT',/** @type {Error} */ (e).message,'calls',calls); }
}
