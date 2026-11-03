import { afterAll } from "bun:test";

import { disposeAllFactStores } from "@shared/fact-array";

// Engines a test never stops leave their fact stores (ADR-009) behind; bun test emits no exit event.
afterAll(() => disposeAllFactStores());
