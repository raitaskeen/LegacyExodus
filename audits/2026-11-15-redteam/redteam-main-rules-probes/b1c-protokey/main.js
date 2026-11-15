const out = [];
out.__proto__ = { push() { return "fake-push"; } };
console.log(out.push(1));
