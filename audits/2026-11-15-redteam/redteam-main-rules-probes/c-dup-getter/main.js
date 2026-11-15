class C { m() { return "method"; } go() { return this.m(); } get m() { return () => "from-getter"; } }
console.log(new C().go());
