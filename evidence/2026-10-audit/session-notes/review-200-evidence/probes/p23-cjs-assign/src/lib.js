exports.run = function () { console.log("L:first.run"); };
Object.assign(module.exports, { run() { console.log("L:assigned.run"); } });
