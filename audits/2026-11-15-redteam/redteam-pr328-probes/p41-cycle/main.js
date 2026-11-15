function f1() { var app = f2(); return app; }
function f2() { var app = f1(); return app; }
function go() { var a = f1(); a.use(); }
console.log("defined");
