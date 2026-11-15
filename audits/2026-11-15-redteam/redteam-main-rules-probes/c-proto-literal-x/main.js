const base = require("./lib");
const child = { __proto__: base, m() { return "child.m"; } };
console.log(child.go());
