$ErrorActionPreference = "Stop"

$BundledNode = "C:\Users\Luis Vera\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$Node = if (Test-Path $BundledNode) { $BundledNode } else { "node" }

Set-Location $PSScriptRoot
& $Node "server.js"
