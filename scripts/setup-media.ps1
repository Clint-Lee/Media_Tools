param([switch]$SkipModels)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Force $runtimeRoot | Out-Null

function Run-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed: $Program (exit $LASTEXITCODE)" }
}

# Prefer an existing uv, otherwise bootstrap it only inside this project.
$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
$uvExecutable = Join-Path $runtimeRoot 'bootstrap/bin/uv.exe'
if ($uvCommand) { $uvExecutable = $uvCommand.Source }
elseif (-not (Test-Path -LiteralPath $uvExecutable)) {
    Run-Checked 'python' @('-m','pip','install','--target',(Join-Path $runtimeRoot 'bootstrap'),'uv','--index-url','https://pypi.tuna.tsinghua.edu.cn/simple')
}
$pythonExecutable = Join-Path $runtimeRoot 'venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    Run-Checked $uvExecutable @('venv',(Join-Path $runtimeRoot 'venv'),'--python','3.12','--managed-python','--cache-dir',(Join-Path $runtimeRoot 'uv-cache'))
}
Run-Checked $uvExecutable @('pip','install','--python',$pythonExecutable,'-r',(Join-Path $PSScriptRoot 'media-requirements.txt'),'--index-url','https://pypi.tuna.tsinghua.edu.cn/simple','--cache-dir',(Join-Path $runtimeRoot 'uv-cache'))
$llmRoot = Join-Path $runtimeRoot 'llm-node'
Run-Checked 'npm.cmd' @('install','--prefix',$llmRoot,'--ignore-scripts','--omit=optional','node-llama-cpp@3.22.1','@node-llama-cpp/win-x64@3.22.1','--registry','https://registry.npmjs.org','--fetch-timeout=30000','--fetch-retries=1')

function Download-Model([string]$Url,[string]$Destination,[string]$Sha256='') {
    if (Test-Path -LiteralPath $Destination) {
        if (-not $Sha256 -or (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -eq $Sha256) { return }
        throw "Existing model hash mismatch: $Destination; inspect it before reinstalling."
    }
    New-Item -ItemType Directory -Force (Split-Path $Destination) | Out-Null
    $partialFile = $Destination + '.part'
    Run-Checked 'curl.exe' @('--noproxy','*','-f','-L','--retry','2','--connect-timeout','20','--max-time','300','-C','-',$Url,'-o',$partialFile)
    if ($Sha256 -and (Get-FileHash -LiteralPath $partialFile -Algorithm SHA256).Hash -ne $Sha256) { throw "Downloaded model hash mismatch: $partialFile" }
    Move-Item -LiteralPath $partialFile -Destination $Destination
}

if (-not $SkipModels) {
    $asrRoot = Join-Path $runtimeRoot 'models/whisper-medium'
    $modelBase = 'https://modelscope.cn/models/pengzhendong/faster-whisper-medium/resolve/master/'
    Download-Model ($modelBase+'model.bin') (Join-Path $asrRoot 'model.bin') '9B45E1009DCC4AB601EFF815B61D80E60CE3FD8C74C1A14F4A282258286B51AE'
    foreach ($filename in @('config.json','tokenizer.json','vocabulary.txt')) { Download-Model ($modelBase+$filename) (Join-Path $asrRoot $filename) }
    Download-Model 'https://modelscope.cn/models/bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF/resolve/master/Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf' (Join-Path $runtimeRoot 'models/qwen/Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf') '2FDE00CE69DD4899C70D020845E2638353015BBA0FDF161B3EB965F2BCA4464E'
    Run-Checked $pythonExecutable @('-c',"from faster_whisper import WhisperModel; WhisperModel(r'$asrRoot',device='cpu',compute_type='int8',local_files_only=True); print('ASR ready')")
}
Write-Host 'Media runtime ready. Start with npm start. Models stay in the ignored .runtime directory.'
