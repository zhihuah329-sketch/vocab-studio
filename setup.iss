#define AppName "词页英语练习工作台"
#define AppVersion "4.2.0"
#define AppExe AppName + ".exe"

[Setup]
AppId=VocabStudio.EnglishPracticeWorkbench
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\VocabStudio
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=VocabStudio-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#AppExe}
CloseApplications=yes
RestartApplications=no
VersionInfoVersion=4.2.0.0

[Languages]
Name: "chinesesimp"; MessagesFile: "installer\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "其他选项："; Flags: unchecked

[Files]
Source: "dist\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "启动{#AppName}"; Flags: nowait postinstall skipifsilent
