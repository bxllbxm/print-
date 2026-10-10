const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const sources=['core.jsxinc','indesign.jsxinc','illustrator.jsxinc','ui.jsxinc'];
const text='/* LAYA 인쇄 점검 v1.0.0 — Adobe 앱 내 실행 도구\n'+
  ' * 문서 자동 수정 없음 / 네트워크 전송 없음\n'+
  ' * 기준: https://blog.naver.com/gilbutzigy/223785925614\n'+
  ' * SPDX-License-Identifier: MIT\n */\n'+sources.map(name=>fs.readFileSync(path.join(root,'src',name),'utf8')).join('\n');
new (require('node:vm').Script)(text);
fs.writeFileSync(path.join(root,'LAYA 인쇄 점검.jsx'),'\uFEFF'+text);
fs.writeFileSync(path.join(root,'LAYA 인쇄 점검.js'),'\uFEFF'+text);
console.log('Built self-contained Adobe script: '+Buffer.byteLength(text)+' bytes');
