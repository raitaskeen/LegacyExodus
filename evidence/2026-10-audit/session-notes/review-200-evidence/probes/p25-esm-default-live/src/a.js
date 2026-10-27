export default function f() { console.log("L:first-default"); }
export function swap() { f = function () { console.log("L:swapped-default"); }; }
