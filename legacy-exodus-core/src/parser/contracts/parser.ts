import type { ParseRequest } from "@parser/models/parse-request";
import type { ParseResponse } from "@parser/models/parse-response";

import type { ParserMetadata } from "./parser-metadata";

export interface Parser extends ParserMetadata {
  canHandle(request: ParseRequest): boolean;
  parse(request: ParseRequest): Promise<ParseResponse>;
}
