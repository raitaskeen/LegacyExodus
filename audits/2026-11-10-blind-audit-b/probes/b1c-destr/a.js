let out = [];
[out] = [{ push() { return 'repo push'; } }];
console.log('b1c-destr:', out.push(1));
let s = '';
for (s of [{ trim() { return 'repo trim'; } }]) {}
console.log('b1c-forof:', s.trim());
let m = new Map();
({ m } = { m: { get() { return 'repo get'; } } });
console.log('b1c-objdestr:', m.get('k'));
