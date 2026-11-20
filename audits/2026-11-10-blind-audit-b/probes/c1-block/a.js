const o = { run() { return 'module-o'; } };
function make() {
  if (true) { const o = { run() { return 'block-o'; } }; void o; }
  return o;
}
const app = make();
console.log('c1-block:', app.run());
