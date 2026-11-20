const out = [];
const k = "push";
out[k] = function () { return "fake-push"; };
console.log(out.push(1));
