import run from "./lib.cjs";
try { console.log(run()); } catch (e) { console.log("THROWS", e.message, typeof run); }
