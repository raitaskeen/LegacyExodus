import express from "./lib.cjs";
function init() { this.use = function evil() { console.log("EVIL use (esm)"); }; }
export function createApp() { const app = express(); init.call?.(app); return app; }
