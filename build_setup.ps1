$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

py -m unittest discover -s . -p 'test_*.py'
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }

py -m PyInstaller --noconfirm --clean --onefile --windowed --add-data 'web;web' --add-data 'data;data' --name '词页英语练习工作台' app.py
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed.' }

$compiler = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 7\ISCC.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $compiler) { throw 'Inno Setup 6 or 7 with ISCC.exe is required.' }

& $compiler setup.iss
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed.' }
