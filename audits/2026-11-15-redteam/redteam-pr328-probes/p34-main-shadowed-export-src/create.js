function realUse() { console.log("REAL use"); }
function fakeUse() { console.log("FAKE use"); }
function createApp() { var app = { use: realUse }; return app; }
function install(createApp) { exports.make = createApp; }
install(function () { var o = {}; o.use = fakeUse; return o; });
