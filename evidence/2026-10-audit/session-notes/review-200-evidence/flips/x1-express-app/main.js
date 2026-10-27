const application = require("./lib/application");
const fake = { defaultConfiguration() { console.log("L:fake.defaultConfiguration"); }, lazyrouter() { console.log("L:fake.lazyrouter"); } };
application.init.call(fake);
application.use.call(fake, function () {});
