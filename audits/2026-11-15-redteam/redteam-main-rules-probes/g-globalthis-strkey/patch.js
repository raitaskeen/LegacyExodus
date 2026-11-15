globalThis["JSON"].stringify = function () { return "patched-via-string-key"; };
