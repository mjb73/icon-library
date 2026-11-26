; Inno Setup script for the Icon Library Windows installer.
; Build (from the PyInstaller output in dist\Icon Library):
;   iscc icon-library.iss
; Produces Output\IconLibrary-Setup-<version>.exe

#define AppName "Icon Library"
#define AppVersion "1.4.4"
#define AppPublisher "Michael Bayes"
#define AppExeName "Icon Library.exe"
#define SourceDir "build\win\Icon Library"

[Setup]
AppId={{4020710F-A384-4170-AB5B-A050533F286C}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
LicenseFile=LICENSE
OutputDir=Output
OutputBaseFilename=IconLibrary-Setup-{#AppVersion}
SetupIconFile=icon-library.ico
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; no admin prompt: per-user install under %LocalAppData%\Programs
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; designs and the live-icon cache live in {localappdata}\IconLibrary and are
; deliberately left behind, so uninstalling never destroys saved designs
Type: dirifempty; Name: "{app}"
