# Entschlüsselt ein Backup und packt es in einen Ordner aus (Datenbank, .env,
# Bankschlüssel). Ohne -Datei wird das neueste Backup genommen.
#
#   powershell -ExecutionPolicy Bypass -File tools\backup\pc-wiederherstellen.ps1
#
# Zurück auf den Pi (App vorher stoppen):
#   ssh haushaltsbuch "cd haushaltsbuch && docker compose stop"
#   scp <ordner>\haushaltsbuch.db haushaltsbuch:haushaltsbuch/data/
#   ssh haushaltsbuch "cd haushaltsbuch && chmod 600 data/* && docker compose start"
param(
    [string]$Datei,
    [string]$Quelle = "$env:USERPROFILE\Haushaltsbuch-Backups",
    [string]$Ausgabe,
    [string]$Schluessel = "$HOME\.haushaltsbuch-backup\backup-schluessel.pem"
)
$ErrorActionPreference = 'Stop'
if (-not $Datei) {
    $Datei = (Get-ChildItem $Quelle -Filter '*.tar.gz.cms' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
    if (-not $Datei) { throw "Kein Backup in $Quelle gefunden." }
}
if (-not $Ausgabe) { $Ausgabe = Join-Path $Quelle ('entpackt_' + [IO.Path]::GetFileNameWithoutExtension([IO.Path]::GetFileNameWithoutExtension([IO.Path]::GetFileNameWithoutExtension($Datei)))) }
New-Item -ItemType Directory -Force $Ausgabe | Out-Null

# openssl aus Git für Windows, tar von Windows selbst (kann gzip ohne Zusatzprogramm)
$openssl = 'C:\Program Files\Git\usr\bin\openssl.exe'
$tar = "$env:SystemRoot\System32\tar.exe"
$zwischen = Join-Path $Ausgabe 'paket.tar.gz'
& $openssl cms -decrypt -binary -inform DER -in $Datei -inkey $Schluessel -out $zwischen
if ($LASTEXITCODE -ne 0) { throw "Entschlüsseln fehlgeschlagen." }
Push-Location $Ausgabe
try {
    & $tar -xzf 'paket.tar.gz'
    if ($LASTEXITCODE -ne 0) { throw "Auspacken fehlgeschlagen." }
} finally { Pop-Location }
Remove-Item $zwischen
Write-Host "Entpackt nach $Ausgabe" -ForegroundColor Green
Get-ChildItem -Force $Ausgabe | Format-Table Name, Length
