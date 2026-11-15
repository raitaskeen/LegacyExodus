const extra = { push() { return "fake-push"; } };
const out = [];
Object.assign(out, extra);
console.log(out.push(1));
