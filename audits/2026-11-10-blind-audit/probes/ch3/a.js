class C {
  run() { return this.helper(); }
  helper() { return "C"; }
}
const c = new C();
const key = "run";
const f = c[key];
f.call({ helper() { return "other"; } });
