$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

py -m unittest discover -s . -p 'test_*.py'
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }

$appName = -join [char[]](0x8BCD, 0x9875, 0x82F1, 0x8BED, 0x7EC3, 0x4E60, 0x5DE5, 0x4F5C, 0x53F0)
py -m PyInstaller --noconfirm --clean --onefile --windowed --exclude-module PyQt5 --exclude-module qtpy --exclude-module PySide2 --exclude-module PySide6 --exclude-module numpy --add-data 'web;web' --add-data 'data;data' --name $appName app.py
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed.' }

$compiler = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 7\ISCC.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $compiler) { throw 'Inno Setup 6 or 7 with ISCC.exe is required.' }

& $compiler setup.iss
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed.' }
