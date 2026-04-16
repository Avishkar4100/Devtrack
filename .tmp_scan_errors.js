const fs=require('fs');
const path=require('path');
const exts=new Set(['.js','.jsx','.ts','.tsx','.py']);
function walk(dir){
  let out=[];
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    if(['node_modules','.git','dist','.venv','__pycache__'].includes(e.name)) continue;
    const p=path.join(dir,e.name);
    if(e.isDirectory()) out=out.concat(walk(p));
    else if(exts.has(path.extname(e.name))) out.push(p);
  }
  return out;
}
const files=walk(process.cwd());
const backend=new Set();
const frontend=new Set();
function add(set,msg){
  const m=String(msg||'').replace(/\\n/g,' ').trim();
  if(!m||m.length<3) return;
  if(/^[A-Za-z0-9_:\\-]+$/.test(m) && m.split(' ').length===1) return;
  set.add(m);
}
const patterns=[
  /toast\\.error\\((['"`])([\\s\\S]*?)\\1/g,
  /throw new Error\\((['"`])([\\s\\S]*?)\\1\\)/g,
  /message\\s*:\\s*(['"`])([\\s\\S]*?)\\1/g,
  /detail\\s*[:=]\\s*(['"`])([\\s\\S]*?)\\1/g,
  /st\\.error\\((['"`])([\\s\\S]*?)\\1\\)/g,
];
for(const f of files){
  const txt=fs.readFileSync(f,'utf8');
  const target=f.includes('backend')?backend:f.includes('frontend')?frontend:null;
  if(!target) continue;
  for(const re of patterns){
    re.lastIndex=0;
    let m;
    while((m=re.exec(txt))!==null){ add(target,m[2]); }
  }
}
const out={
  backend:[...backend].sort((a,b)=>a.localeCompare(b)),
  frontend:[...frontend].sort((a,b)=>a.localeCompare(b)),
};
fs.writeFileSync('.tmp_error_inventory.json', JSON.stringify(out,null,2));
console.log('backend='+out.backend.length);
console.log('frontend='+out.frontend.length);
