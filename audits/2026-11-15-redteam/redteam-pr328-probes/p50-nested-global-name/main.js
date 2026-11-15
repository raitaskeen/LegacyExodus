function outer() { function setTimeout() { console.log("NESTED setTimeout"); } return setTimeout; }
function plain() { const o = { setTimeout }; return o; }
const p = plain();
p.setTimeout(function () { console.log("GLOBAL setTimeout ran"); }, 0);
