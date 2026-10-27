function make() { return { init() { console.log("L:make.init"); } }; }
const app = make();
app.init ??= function () { console.log("L:nullish.init"); };
console.log("S:nullish-def"); app.init();
