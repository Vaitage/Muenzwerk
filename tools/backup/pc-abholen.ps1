# Holt die verschlüsselten Backups vom Pi auf den PC. Läuft als geplante
# Aufgabe "Haushaltsbuch-Backup abholen" (bei Anmeldung und täglich).
# Entschlüsseln: tools/backup/pc-wiederherstellen.ps1
param(
    [string]$Ziel = "$env:USERPROFILE\Haushaltsbuch-Backups",
    [int]$BehaltenTage = 90,
    [int]$MindestensBehalten = 10
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Ziel | Out-Null
$log = Join-Path $Ziel 'abholen.log'
function Log($text) { "$(Get-Date -Format 'dd.MM.yyyy HH:mm') $text" | Out-File -Append -Encoding utf8 $log }

try {
    $liste = ssh -o BatchMode=yes -o ConnectTimeout=15 haushaltsbuch 'ls -1 backups/*.tar.gz.cms 2>/dev/null'
    if ($LASTEXITCODE -ne 0 -and -not $liste) { throw "Pi nicht erreichbar (ssh-Code $LASTEXITCODE)" }
    $neu = 0
    foreach ($datei in $liste) {
        $name = Split-Path $datei -Leaf
        $lokal = Join-Path $Ziel $name
        if (Test-Path $lokal) { continue }
        scp -q -o BatchMode=yes "haushaltsbuch:$datei" $lokal
        if ($LASTEXITCODE -ne 0) { throw "Kopieren von $name fehlgeschlagen" }
        $neu++
    }
    # Alte Backups löschen, aber immer die neuesten behalten
    $alle = Get-ChildItem $Ziel -Filter '*.tar.gz.cms' | Sort-Object LastWriteTime -Descending
    $alle | Select-Object -Skip $MindestensBehalten |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$BehaltenTage) } |
        Remove-Item -Force
    Log "ok, $neu neu, $($alle.Count) vorhanden"
} catch {
    Log "FEHLER: $_"
    exit 1
}
