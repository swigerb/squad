---
"@bradygaster/squad-cli": patch
---

Use the supported Aspire CLI 17+ standalone dashboard command by default, keeping
the existing UI/OTLP ports, anonymous local access and ephemeral history.
Honor the requested UI port and handle early child-process failures. Report
missing prerequisites, spawn errors and abnormal dashboard exits as failed commands. Keep
`--docker` as an explicit legacy-image option without a silent fallback;
the Aspire 17 container tag remains held pending publication. No .NET workload
or local AppHost is required.
