# Support

Thank you for using LegacyExodus.

LegacyExodus is a deterministic, knowledge-first modernization engine designed to analyze legacy software systems and build an evidence-backed understanding of their structure, dependencies, semantics, control flow, data flow, and modernization risks.

## Before requesting support

Please make sure you are using the latest version of LegacyExodus and have run the available test suite successfully.

For analysis issues, please include:

* LegacyExodus version
* Operating system
* Bun version
* Node.js version, if applicable
* Repository language(s)
* The exact command that was executed
* The complete error message or output
* Whether the issue is reproducible
* A minimal reproducible repository or fixture, when possible

Please remove passwords, API keys, tokens, private source code, credentials, and other sensitive information before sharing logs or repositories.

## Reporting a bug

Please use the GitHub issue tracker for reproducible defects.

A useful bug report should contain:

1. A clear description of the problem.
2. Steps to reproduce it.
3. Expected behavior.
4. Actual behavior.
5. Relevant command output.
6. A minimal reproduction when possible.

Example:

```text
Command:
bun legacy-exodus analyze ../example-project --json

Expected:
The project is analyzed and the unresolved relationship is reported explicitly.

Actual:
The analysis terminates with SYMBOL_TABLE_INVALID.

Environment:
OS: Windows 11
Bun: 1.x
LegacyExodus: 0.1.0
```

## Analysis accuracy issues

LegacyExodus follows an evidence-first and conservative analysis model.

The engine intentionally avoids fabricating relationships when the available source evidence is insufficient. A relationship may therefore be reported as unresolved rather than guessed.

When reporting an analysis-accuracy issue, please provide:

* the smallest source example that demonstrates the issue;
* the expected symbol, dependency, call, flow, or resolution;
* the actual LegacyExodus result;
* the relevant file path and source location, if available.

This makes it possible to determine whether the issue is a parser limitation, symbol-model limitation, resolution limitation, or another analysis-layer limitation.

## Security issues

Please do not publicly disclose security vulnerabilities through the normal issue tracker.

For security-sensitive issues, contact the project maintainers privately and include enough information to reproduce and assess the vulnerability without exposing unnecessary sensitive data.

Do not include credentials, secrets, access tokens, private keys, or confidential customer data.

## Feature requests

Feature requests are welcome when they are supported by a concrete modernization use case.

Useful requests explain:

* the problem that needs to be solved;
* who needs the capability;
* the expected behavior;
* examples of source repositories or constructs involved;
* why the capability cannot be achieved with the current analysis model.

For language support requests, include the language and the type of legacy systems you expect LegacyExodus to analyze.

## Language support

LegacyExodus is being developed around a language-frontend architecture.

Current support and future language coverage should be determined by the capabilities exposed by the current release rather than assumed from the presence of files in a repository.

A repository may contain files that are intentionally inventoried but are not semantic-analysis inputs.

An analysis result may distinguish between:

* analyzed source files;
* parser failures;
* symbol-extraction failures;
* unsupported source languages or syntax;
* non-source repository artifacts.

This distinction is intentional and helps keep analysis results truthful and deterministic.

## Pull requests

Contributions are welcome.

Before submitting a pull request:

```bash
bun test
bun run typecheck
git diff --check
```

Please keep pull requests focused and include tests for behavioral changes.

Changes affecting analysis contracts should preserve the project's core principles:

* deterministic results;
* stable canonical identities;
* evidence-backed relationships;
* conservative unresolved behavior;
* no fabricated dependency, call, or data-flow edges;
* explicit failure handling;
* immutable and validated analysis artifacts.

## Community support

For general questions, discussions about architecture, and ideas for improving LegacyExodus, use the project's GitHub discussion or community channels when available.

Please avoid posting private customer repositories or proprietary source code in public channels.

## Scope of support

LegacyExodus is an actively developing project.

Analysis behavior may evolve as additional languages, syntax constructs, semantic relationships, and modernization capabilities are added.

A reported result being `UNRESOLVED` does not necessarily indicate a defect. In many cases it means that LegacyExodus intentionally refused to infer a relationship that could not be proven from the available evidence.

Thank you for helping improve LegacyExodus.
