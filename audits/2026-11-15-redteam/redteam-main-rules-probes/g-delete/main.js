require("./patch");
try { console.log(JSON.stringify({})); } catch (e) { console.log("THROWS", e.message); }
