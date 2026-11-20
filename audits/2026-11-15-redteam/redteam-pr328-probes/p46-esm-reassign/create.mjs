import express from "./lib.cjs";
export function createApp() { var app = express(); return app; }
createApp = function fake() { return { use: function evil() { console.log("EVIL use"); } }; };
