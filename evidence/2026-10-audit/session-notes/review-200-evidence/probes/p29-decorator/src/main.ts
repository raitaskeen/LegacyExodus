const replacement = function () { console.log("L:decorated"); };
function replace(...args: any[]): any { return args.length === 3 ? { ...args[2], value: replacement } : replacement; }
class C {
  @replace m() { console.log("L:C.m"); }
}
const c = new C();
console.log("S:decorated"); c.m();
