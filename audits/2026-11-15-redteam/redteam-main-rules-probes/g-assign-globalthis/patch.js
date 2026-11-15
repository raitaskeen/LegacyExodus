Object.assign(globalThis, { queueMicrotask: function () { return "patched-via-assign"; } });
