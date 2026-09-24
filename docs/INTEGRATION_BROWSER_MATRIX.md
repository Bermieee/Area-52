# Integration Browser Matrix

Core browser safety is already an executable gate. Wave 4 adds the declaration contract needed to extend that gate across assembled subsystems.

Each subsystem can declare:
- browserRuntimePaths;
- nodeOnlyToolPaths;
- requiredWebApis;
- optionalWebApis;
- hostCapabilities.

The matrix can check integration-visible source for Node-only assumptions and can separately track required browser/host capabilities. Node-only benchmark or maintenance scripts are legal when declared outside browserRuntimePaths.

Integration categories include:
- Buffer;
- process;
- require;
- node: imports;
- filesystem calls;
- Web Crypto;
- TextEncoder;
- structuredClone;
- AbortController;
- fetch;
- IndexedDB/local persistence;
- CSP/module loading;
- reload/update host behavior.

Worker 1 Core source/runtime acceptance remains green, but #185 stays open because the issue requires assembled-`main` plus real SillyTavern clean-install/update/reload acceptance. A browser-safe worker lane is not equivalent to a live-green integrated product.
