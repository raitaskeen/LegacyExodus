async function make() {
  const o = { run() { return 'literal'; } };
  return o;
}
const app = make();
try { console.log('c1-async:', app.run()); } catch (e) { console.log('c1-async throws:', e.constructor.name); }
