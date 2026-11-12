Object.defineProperty(String.prototype, 'trim', { value: function () { return 'repo-trim'; }, configurable: true });
const s = ' a ';
console.log('ex-define', s.trim());
const parse = JSON.parse;
Object.assign(JSON, { parse: function () { return 'repo-parse'; } });
console.log('ex-define', JSON.parse('1'));
