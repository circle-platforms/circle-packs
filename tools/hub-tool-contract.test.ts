import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collect} from './modules.ts';

test('current skills use only hub tool names declared by their own remote tool contract',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const skills=collect(root).modules.filter(module=>module.kind==='skill-pack');
 assert.ok(skills.length>0);
 for(const module of skills){
  const manifest=JSON.parse(readFileSync(join(root,module.manifestPath),'utf8'));
  const declared=new Set(manifest.tools.map((name:string)=>'hub_tool_'+name.replace(/[^A-Za-z0-9_]/g,'_')));
  const text=readFileSync(join(root,module.root,'SKILL.md'),'utf8');
  assert.match(text,/Circle 1\.7\.0/);
  assert.match(text,/\/hub login/);
  assert.doesNotMatch(text,/\bsrv_[a-z]|\bcircle_server_|\/server\b|\bcircle-server\b/);
  const names=[...text.matchAll(/\bhub_tool_([a-z][a-z0-9_]*[a-z0-9])\b/g)].map(match=>match[0]);
  assert.ok(names.length>0,module.id);
  for(const name of names)assert.ok(declared.has(name),`${module.id} asks for an undeclared tool ${name}`);
 }
});
