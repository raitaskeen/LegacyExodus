class C { go() { return this.m(); } m() { return "C.m"; } }
const child = Object.create(new C(), { m: { value: function () { return "descriptor.m"; } } });
console.log(child.go());
