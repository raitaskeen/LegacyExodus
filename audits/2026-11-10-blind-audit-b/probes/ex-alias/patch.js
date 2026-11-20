const c = console;
c.log = function () { process.stdout.write('[repo logger] ' + [...arguments].join(' ') + '\n'); };
