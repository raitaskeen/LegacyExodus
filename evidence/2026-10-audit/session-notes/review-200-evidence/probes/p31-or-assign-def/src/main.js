function make() { return { init() { console.log("L:make.init"); } }; }
const svc = make();
svc.init ||= function () { console.log("L:or.init"); };
console.log("S:or-def"); svc.init();
