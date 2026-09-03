param(
  [string]$Timeline = (Join-Path $PSScriptRoot '..\docs\demo-video\narration-timeline.json'),
  [string]$RawVideo = (Join-Path $PSScriptRoot '..\docs\demo-video\NiyamLens_Live_Prototype_Walkthrough.raw.webm'),
  [string]$Output = (Join-Path $PSScriptRoot '..\docs\NiyamLens_Live_Prototype_Walkthrough.mp4')
)

$ErrorActionPreference = 'Stop'
$timelineData = Get-Content -LiteralPath $Timeline -Raw | ConvertFrom-Json
$clipDirectory = Join-Path (Split-Path -Parent $Timeline) 'voice-clips-local'
New-Item -ItemType Directory -Path $clipDirectory -Force | Out-Null

$voice = New-Object -ComObject SAPI.SpVoice
$preferredVoice = @($voice.GetVoices()) | Where-Object { $_.GetDescription() -match 'Zira' } | Select-Object -First 1
if ($preferredVoice) { $voice.Voice = $preferredVoice }
$voice.Rate = 2
$voice.Volume = 100

$clips = @()
for ($index = 0; $index -lt $timelineData.segments.Count; $index++) {
  $clipPath = Join-Path $clipDirectory ('segment-{0:D2}.wav' -f ($index + 1))
  $stream = New-Object -ComObject SAPI.SpFileStream
  $stream.Open($clipPath, 3, $false)
  $voice.AudioOutputStream = $stream
  [void]$voice.Speak([string]$timelineData.segments[$index].text)
  $stream.Close()
  $voice.AudioOutputStream = $null
  $clips += [pscustomobject]@{
    Path = $clipPath
    Start = [int]$timelineData.segments[$index].startMs
  }
}

$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$arguments = @('-y', '-i', $RawVideo)
foreach ($clip in $clips) { $arguments += @('-i', $clip.Path) }

$filters = @()
$mixInputs = @()
for ($index = 0; $index -lt $clips.Count; $index++) {
  $inputIndex = $index + 1
  $label = "voice$index"
  $delay = $clips[$index].Start
  $filters += "[$inputIndex`:a]adelay=$delay|$delay,volume=1.15[$label]"
  $mixInputs += "[$label]"
}
$filters += (($mixInputs -join '') + "amix=inputs=$($clips.Count):normalize=0:dropout_transition=0,alimiter=limit=0.95,apad[aout]")

$arguments += @(
  '-filter_complex', ($filters -join ';'),
  '-map', '0:v:0',
  '-map', '[aout]',
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', '23',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', '160k',
  '-movflags', '+faststart',
  '-shortest',
  $Output
)

& $ffmpeg @arguments
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed with exit code $LASTEXITCODE" }
Write-Output "Created $Output"
