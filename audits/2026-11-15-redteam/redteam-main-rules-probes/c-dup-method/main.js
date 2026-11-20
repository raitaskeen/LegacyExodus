class C { m() { return "first"; } go() { return this.m(); } m() { return "second"; } }
console.log(new C().go());
