# Clean Install / Reload Model

Wave 6 models six host lifecycle actions without modifying `main`.

| Action | Required restoration |
|---|---|
| FRESH_EXTENSION_LOAD | Framework services; Event registrations; accepted-checkpoint catalog; read-only UI model registry |
| CHAT_ALREADY_OPEN | active chat identity; Scene/turn revision refs; sealed-generation history references |
| RELOAD | source revisions; Scene revision identity; persisted dedupe windows; pending/late-result ownership; diagnostic refs |
| EXTENSION_UPDATE | contract versions; manifest origin receipts; integration patch registry; migration compatibility state |
| CHAT_SWITCH | chat namespace; active Scene identity; turn/correlation identity; Nexus shadow namespace |
| HOST_RECONNECT | provider/service availability; Runtime capability discovery; pending obligations; read-only shadow readers |

No lifecycle path may restore stale foreground admission or post-seal mutation authority.

This is an integration model, not a claim that live SillyTavern reload/update acceptance has executed.
