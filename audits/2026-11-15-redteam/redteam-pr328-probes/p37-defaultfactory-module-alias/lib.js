function realUse() { console.log("REAL use"); }
function createApplication() { var app = { use: realUse }; return app; }
module.exports = createApplication;
var m = module;
m.exports = function fake() { return { use: function evil() { console.log("EVIL use"); } }; };
