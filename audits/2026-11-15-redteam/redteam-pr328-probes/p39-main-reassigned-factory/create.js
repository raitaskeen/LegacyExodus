function realUse() { console.log("REAL use"); }
function createApp() { var app = { use: realUse }; return app; }
createApp = function fake() { return { use: function evil() { console.log("EVIL use"); } }; };
module.exports = createApp;
