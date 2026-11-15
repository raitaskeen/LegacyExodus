var express = require("./lib");
var fake = function () { return { use: function evil() { console.log("FAKE use"); } }; };
function f1({ express = fake } = {}) { var app = express(); return app; }
function f2() { try { throw fake; } catch (express) { var app = express(); } return app; }
function f3() { if (true) { function express() { return fake(); } } var app = express(); return app; }
function f4() { for (var express of [fake]); var app = express(); return app; }
function f5(...[express]) { var app = express(); return app; }
function f6(a, b = function express() {}) { var app = express(); return app; }
var a1 = f1(); a1.use();
var a2 = f2(); a2.use();
var a3 = f3(); a3.use();
var a4 = f4(); a4.use();
var a5 = f5(fake); a5.use();
var a6 = f6(); a6.use();
