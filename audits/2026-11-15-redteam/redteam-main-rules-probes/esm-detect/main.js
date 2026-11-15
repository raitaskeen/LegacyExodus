import fs from "fs";
try { const p = require("path"); console.log(p.join("a", "b")); } catch (e) { console.log("THROWS", e.message); }
