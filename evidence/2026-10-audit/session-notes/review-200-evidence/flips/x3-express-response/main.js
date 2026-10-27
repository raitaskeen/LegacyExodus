const res = require("./lib/response");
res.json.call({ get() { console.log("L:fake.get"); }, set() { console.log("L:fake.set"); return this; } }, {});
