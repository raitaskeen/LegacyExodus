const src = require("./src");
function make() {
  const o = { run() { return "literal-run"; } };
  Object.assign(o, src);
  return o;
}
const x = make();
console.log(x.run());
