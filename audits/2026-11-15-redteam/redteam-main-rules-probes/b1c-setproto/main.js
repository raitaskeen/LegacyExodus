const out = [];
Object.setPrototypeOf(out, { push() { return "fake-push"; } });
console.log(out.push(1));
