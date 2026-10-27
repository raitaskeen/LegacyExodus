const Router = require("./lib/router");
Router.get.call({ route() { console.log("L:fake.route"); return {}; } }, "/x");
