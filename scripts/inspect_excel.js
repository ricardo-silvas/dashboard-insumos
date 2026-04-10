const XLSX = require('xlsx');
const buf  = require('fs').readFileSync('excel/serie_acucarcristal.xls');
const wb   = XLSX.read(buf, { type: 'buffer' });
const sh   = wb.Sheets[wb.SheetNames[0]];
const j    = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true });

console.log('=== Primeiras 8 linhas ===');
for (let i = 0; i < 8; i++) console.log(i, JSON.stringify(j[i]));

console.log('\n=== Últimas 5 linhas ===');
for (let i = j.length - 5; i < j.length; i++) console.log(i, JSON.stringify(j[i]));

console.log('\n=== Açúcar Refinado ===');
const buf2 = require('fs').readFileSync('excel/serie_acucarrefinado.xls');
const wb2  = XLSX.read(buf2, { type: 'buffer' });
const sh2  = wb2.Sheets[wb2.SheetNames[0]];
const j2   = XLSX.utils.sheet_to_json(sh2, { header: 1, raw: true });
for (let i = 0; i < 8; i++) console.log(i, JSON.stringify(j2[i]));
console.log('--- Ultimas 5 ---');
for (let i = j2.length - 5; i < j2.length; i++) console.log(i, JSON.stringify(j2[i]));
