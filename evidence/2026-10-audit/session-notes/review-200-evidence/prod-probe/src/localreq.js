function h() { console.log("L:local-h"); }
function lazy() { const h = require("./helper"); return h; }
console.log("S:module-h"); h();
