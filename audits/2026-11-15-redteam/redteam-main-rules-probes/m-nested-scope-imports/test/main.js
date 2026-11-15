try { const lib = require("#lib"); console.log(lib.run()); } catch (e) { console.log("THROWS", e.code); }
