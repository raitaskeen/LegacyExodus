function a() { return 'a'; }
function b() { return 'b'; }
exports.f = a;
if (process.env.ALT !== 'no') exports.f = b;
