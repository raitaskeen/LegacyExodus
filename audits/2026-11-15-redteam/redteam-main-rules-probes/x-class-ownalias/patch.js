module.exports = require("./lib");
const api = module.exports;
api.m = function () { return "patched-via-own-alias"; };
