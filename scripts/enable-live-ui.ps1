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
    Write-Log "开始检查并更新 ZCode 实时可折叠指标渲染补丁..."
    if (-not (Test-Path -LiteralPath $zcodeCjs)) {
        throw "找不到文件: $zcodeCjs"
    }

    if (-not (Test-Path -LiteralPath $backup)) {
        Copy-Item -LiteralPath $zcodeCjs -Destination $backup -Force
        Write-Log "已备份原文件到: $backup"
    } else {
        # 先从干净备份恢复再打最新补丁，确保幂等升级
        Copy-Item -LiteralPath $backup -Destination $zcodeCjs -Force
    }

    $nodeScript = @'
const fs = require("fs");
const p = "F:/Program Files/ZCode/resources/glm/zcode.cjs";
let s = fs.readFileSync(p, "utf8");
const target = 'if(u){let Tt=this.hookBlockErrorDelta(t,n,L,B);return[{op:"row.upserted",row:{...u,...Ce}},...Tt?[Tt]:[]]}';
const replacement = 'if(u){/*zcode-turn-metrics-live-v2*/let Tt=this.hookBlockErrorDelta(t,n,L,B),_m=[];if(n.hookEventName==="Stop"&&B&&B.includes("TTFT")){let _w=this.snapshot.rows.window,_r=[..._w].reverse().find(x=>x.kind==="assistantText"&&x.turnId===u.turnId);if(_r&&!_r.text.includes("zcode-turn-metrics")){let _txt=null;try{const {DatabaseSync}=require("node:sqlite"),_db=new DatabaseSync("F:/wendang/ZCODE/.zcode/cli/db/db.sqlite",{open:true,readOnly:true});const _p=_db.prepare("SELECT data FROM part WHERE session_id=? AND json_extract(data,\x27$.type\x27)=\x27text\x27 ORDER BY time_updated DESC LIMIT 1").get(String(t.sessionId||""));_db.close();if(_p){const _d=JSON.parse(_p.data);if(_d&&typeof _d.text==="string"&&_d.text.includes("zcode-turn-metrics"))_txt=_d.text}}catch{}if(!_txt)_txt=_r.text.trimEnd()+"\\n\\n<!-- zcode-turn-metrics -->\\n<details><summary>\\uD83D\\uDCCA <b>\\u672C\\u8F6E\\u5747\\u503C</b> &nbsp;\\uFF5C&nbsp; "+B+"</summary></details>";_m.push({op:"row.upserted",row:{..._r,text:_txt}})}}return[{op:"row.upserted",row:{...u,...Ce}},..._m,...Tt?[Tt]:[]]}';
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
    Write-Log "完成！请重启 ZCode 使实时可折叠均值指标渲染生效。"
} catch {
    Write-Log ("错误: " + $_.Exception.Message)
    exit 1
}
