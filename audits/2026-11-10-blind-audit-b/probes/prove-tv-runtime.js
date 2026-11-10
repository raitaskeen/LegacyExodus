// Runtime proof: request input reaches child_process.execSync through the arrow helper.
const cp = require('child_process');
const seen = [];
cp.execSync = (cmd) => { seen.push(cmd); return ''; };
require('./tv-runtime/app').h({ query: { c: 'TAINT' } }, { end() {} });
console.log('tv-runtime: execSync received', JSON.stringify(seen));
