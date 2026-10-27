export function f() { console.log("L:first-f"); }
export function swap() { f = function () { console.log("L:swapped-f"); }; }
