function a() { return 'a'; }
function b() { return 'b'; }
export let f = a;
export function swap() { f = b; }
