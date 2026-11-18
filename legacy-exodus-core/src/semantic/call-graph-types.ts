/** Types shared by the call-graph modules: the per-file symbol index, the resolution context and binding writes. */
import type { ASTNode } from "@parser/index";
import { type CodeSymbol } from "@symbols/index";
import { ClassHierarchy } from "./class-hierarchy";
import { FactoryIndex } from "./factory-objects";
import type { ScopeFrame, SourcePoint } from "./scope-model";

export interface FileSymbolIndex {
  readonly byScopeAndName: ReadonlyMap<string, readonly CodeSymbol[]>;
  /** byScopeAndName restricted to symbols that declare a binding (see bindingDeclarations). */
  readonly declarationsByScopeAndName: ReadonlyMap<string, readonly CodeSymbol[]>;
  readonly byName: ReadonlyMap<string, readonly CodeSymbol[]>;
  readonly firstImportByName: ReadonlyMap<string, CodeSymbol>;
  readonly classByLocation: ReadonlyMap<string, CodeSymbol>;
  readonly lexicalBindings: ReadonlyMap<string, LexicalResolution>;
  /** Function, method and class symbols: the owners fact keys are built from (ADR-008). */
  readonly ownerSymbols: readonly CodeSymbol[];
  /**
   * For each block of a namespace that is declared in more than one block, the names declared in its
   * other blocks. TypeScript merges the exports of those blocks, so an unqualified name that this
   * block does not bind may mean a member of another block; it must not resolve to an outer binding.
   */
  readonly reopened: ReadonlyMap<string, ReadonlySet<string>>;
  readonly writes: BindingWrites;
  /** Export symbols (of any module) whose value can change after definition. */
  readonly unstableExportIds: ReadonlySet<string>;
  /**
   * RT-M9: imports whose module is in this file's require cycle (a load-time call through one may run too early), each
   * mapped to whether that module may leave this file holding its replaced `module.exports` for the whole run.
   */
  readonly cycleImports: ReadonlyMap<string, boolean>;
  readonly classes: ClassFacts;
  /** The file calls `eval(…)` directly, which can declare or reassign any binding it sees: no call here is proven (NA-02). */
  readonly directEval: boolean;
}

/** Class structure read from the AST; the symbol table also files nested object literal methods under a class. */
export interface ClassFacts {
  /** Declaration node of each class symbol. */
  readonly nodes: ReadonlyMap<string, ASTNode>;
  /** Class symbols that a decorator may replace. */
  readonly decorated: ReadonlySet<string>;
  /** Methods declared directly in a class body, by declaration anchor. */
  readonly members: ReadonlyMap<string, ClassMemberFact>;
}

export interface ClassMemberFact {
  readonly classNode: ASTNode;
  readonly isStatic: boolean;
  /** `method`, `get`, `set` or `constructor`; `field` for a field initialized with a function. */
  readonly kind: string;
  readonly decorated: boolean;
}

/**
 * File-wide write evidence. A call target derived from a binding's value is proven
 * only when no execution can reach the call with a different value in that binding.
 */
export interface BindingWrites {
  /** Binding keys (`scopeId:name`) declared more than once or written after declaration. */
  readonly reboundBindings: ReadonlySet<string>;
  /**
   * Member writes and deletions per property name (`anything.name = …`, `anything["name"] = …`,
   * `delete anything.name`, statically keyed Object/Reflect writes); private names as `#name`.
   */
  readonly propertyWrites: ReadonlyMap<string, number>;
  /** A write whose property name is not static (`o[key] = …`, `Object.assign(o, src)`, prototype swaps): it may name any public property. */
  readonly unknownPropertyWrites: boolean;
  /**
   * An unknown write other than a computed member write (`o[key] = …`): a prototype swap (`o.__proto__ = …`,
   * `Object.setPrototypeOf`), a reflective write with an unknown key or source (`Object.assign(o, src)`), or a reflective
   * writer reached another way. Such a write may give a literal value an own method of any name (RT-M5).
   */
  readonly unknownReflectiveWrites: boolean;
  /** Binding keys whose `__proto__` the file writes (`out.__proto__ = …`) (RT-M5). */
  readonly protoSwapTargets: ReadonlySet<string>;
  /**
   * Binding keys the file uses as a value that can be handed on (`f(out)`, `x = out`, `return out`; see usedAsValue):
   * their value may reach a reflective write through another name (RT-M5).
   */
  readonly escapedNames: ReadonlySet<string>;
  /** Binding keys that are the target of an unknown reflective write (`Object.setPrototypeOf(out, …)`) (RT-M5). */
  readonly reflectiveTargets: ReadonlySet<string>;
  /** For each binding key, the binding keys it is a plain alias of (`const a = out`, `a = out`) (RT-M5). */
  readonly aliasSources: ReadonlyMap<string, ReadonlySet<string>>;
  /** Whether a reflective writer is reached another way (`const assign = Object.assign`): its targets are not known (RT-M5). */
  readonly escapedReflectiveWriters: boolean;
  /** Where each statically named member is assigned or deleted (`o.name = …`, `delete o.name`). */
  readonly propertyWriteSites: ReadonlyMap<string, readonly WriteSite[]>;
  /**
   * Value each binding is declared with: its initializer, or the function a declaration creates. A declarator that
   * may not run whenever its binding's scope is entered (RT-L2: `if (…) { var x = make(); }` leaves `x` undefined on
   * the other path) records one only when every use of the binding follows it in the same branch of the same function.
   */
  readonly declaredValues: ReadonlyMap<string, ASTNode>;
  /** Every write to a binding, including implicit parameter, catch and for-in/of writes. */
  readonly writeSites: ReadonlyMap<string, readonly WriteSite[]>;
  /** Execution context (function or class element) in which each binding is declared. */
  readonly declaringContext: ReadonlyMap<string, string>;
  /** Where each call expression executes. */
  readonly callSites: ReadonlyMap<ASTNode, ExecutionSite>;
  /** The execution context and end of each variable declarator, by declaration anchor (XA-05). */
  readonly declaratorSites: ReadonlyMap<string, { readonly contextId: string; readonly end: SourcePoint }>;
  /** Frame (with its enclosing frames) for each scope id, to resolve names as seen from a symbol's scope. */
  readonly scopeFrames: ReadonlyMap<string, ScopeFrame>;
  /** Binding keys whose declaration the symbol table places in the wrong scope (see collectUnscopedBindings). */
  readonly unscopedBindings: ReadonlySet<string>;
  /**
   * Binding keys, in every frame from a block up to its function, of names that a function declared in a nested
   * block or case also binds in the function (Annex B, non-strict code only): the outer name may hold that function.
   */
  readonly blockFunctionVars: ReadonlySet<string>;
}

export interface ExecutionSite {
  /** Function, class field initializer or static block whose execution runs this code. */
  readonly contextId: string;
  /** Loops, within that context, that enclose this code. */
  readonly loopIds: readonly string[];
  readonly start: SourcePoint;
}

export interface WriteSite extends ExecutionSite {
  readonly end: SourcePoint;
  /** False when the write has no source location and so cannot be ordered against a call. */
  readonly ordered: boolean;
  /** True when the write runs whenever its context reaches it: no branch, loop, try or short circuit. */
  readonly unconditional: boolean;
  /** `binding = new Class()` with an identifier class reference, resolved lazily. */
  readonly constructed?: { readonly className: string; readonly scope: ScopeFrame };
}

export interface ResolutionContext {
  readonly callerName: string;
  readonly scope: ScopeFrame;
  readonly containerId?: string;
  readonly containerName?: string;
  readonly receiverTypes: ReadonlyMap<string, string | null>;
  readonly constantBindings: ReadonlyMap<string, string | null>;
  /** Inside a `with` body: the frame around the `with` statement (NA-02). */
  readonly withOuter?: ScopeFrame;
  readonly hierarchy?: ClassHierarchy;
  /** Objects repository factories return (Phase C1, factory-objects.ts). */
  readonly factories?: FactoryIndex;
  /** Standard-global paths the run's files write (ADR-012, Phase B1b; collectGlobalWrites). */
  readonly globalWrites?: ReadonlySet<string>;
  /** Where `this` is an instance (or, static, the constructor) of a class: see thisClassFor. */
  readonly thisClass?: ThisClass;
}

export interface ThisClass {
  readonly classId: string;
  readonly isStatic: boolean;
  /** The method whose body this is, which could be borrowed; none in a field initializer, static block or constructor. */
  readonly method?: string;
}

export type LexicalResolution =
  | { readonly state: "NO_BINDING" }
  | { readonly state: "BLOCKED_AMBIGUOUS" }
  | {
      readonly state: "ONE_BINDING";
      readonly canonical: CodeSymbol;
      readonly referenceTargets: readonly CodeSymbol[];
    };

export interface LexicalBinding {
  readonly canonical: CodeSymbol;
  readonly referenceTargets: readonly CodeSymbol[];
}
