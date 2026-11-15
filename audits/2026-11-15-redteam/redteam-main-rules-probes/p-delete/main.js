require("./patch");
const path = require("path");
try { console.log(path.join("a", "b")); } catch (e) { console.log("THROWS", e.message); }
