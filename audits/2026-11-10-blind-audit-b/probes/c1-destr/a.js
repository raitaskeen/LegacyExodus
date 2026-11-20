function make(other) {
  let o = { run() { return 'literal'; } };
  [o] = [other];
  return o;
}
const app = make({ run() { return 'swapped'; } });
console.log('c1-destr:', app.run());
