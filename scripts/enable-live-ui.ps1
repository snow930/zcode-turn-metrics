#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$zcodeCjs = 'F:\Program Files\ZCode\resources\glm\zcode.cjs'
$backup   = 'F:\Program Files\ZCode\resources\glm\zcode.cjs.bak-turn-metrics'
$logFile  = 'F:\wendang\ZCODE\plugins\turn-metrics\patch-live-ui.log'

function Write-Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Host $line
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

try {
    Write-Log "开始检查 ZCode 实时指标渲染补丁..."
    if (-not (Test-Path -LiteralPath $zcodeCjs)) {
        throw "找不到文件: $zcodeCjs"
    }

    if (-not (Test-Path -LiteralPath $backup)) {
        Copy-Item -LiteralPath $zcodeCjs -Destination $backup -Force
        Write-Log "已备份原文件到: $backup"
    }

    $nodeScript = @'
const fs = require("fs");
const p = "F:/Program Files/ZCode/resources/glm/zcode.cjs";
let s = fs.readFileSync(p, "utf8");
if (s.includes("/*zcode-turn-metrics-live*/")) {
  console.log("ALREADY_PATCHED");
  process.exit(0);
}
const target = 'if(u){let Tt=this.hookBlockErrorDelta(t,n,L,B);return[{op:"row.upserted",row:{...u,...Ce}},...Tt?[Tt]:[]]}';
const replacement = 'if(u){/*zcode-turn-metrics-live*/let Tt=this.hookBlockErrorDelta(t,n,L,B),_m=[];if(n.hookEventName==="Stop"&&B&&B.includes("TTFT")){let _w=this.snapshot.rows.window,_r=[..._w].reverse().find(x=>x.kind==="assistantText"&&x.turnId===u.turnId);if(_r&&!_r.text.includes("zcode-turn-metrics")){let _nx={..._r,text:_r.text.trimEnd()+"\\n\\n---\\n<!-- zcode-turn-metrics -->\\n> \\uD83D\\uDCCA **\\u672C\\u8F6E\\u6307\\u6807** \\uFF5C "+B};_m.push({op:"row.upserted",row:_nx})}}return[{op:"row.upserted",row:{...u,...Ce}},..._m,...Tt?[Tt]:[]]}';
if (!s.includes(target)) {
  console.error("TARGET_NOT_FOUND");
  process.exit(2);
}
s = s.replace(target, replacement);
fs.writeFileSync(p, s, "utf8");
console.log("PATCH_SUCCESS");
'@

    $out = node -e $nodeScript 2>&1
    Write-Log ("补丁结果: " + ($out -join " "))
    if ($LASTEXITCODE -ne 0) {
        throw "补丁执行失败 (exit=$LASTEXITCODE)"
    }
    Write-Log "完成！请重启 ZCode 使实时正文底部指标渲染生效。"
} catch {
    Write-Log ("错误: " + $_.Exception.Message)
    exit 1
}
