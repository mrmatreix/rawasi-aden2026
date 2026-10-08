$cscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$workDir = $PSScriptRoot
Set-Location $workDir

if (-not (Test-Path "assets")) {
    New-Item -ItemType Directory -Path "assets" -Force | Out-Null
}
if (Test-Path "images\app.ico") {
    Copy-Item "images\app.ico" -Destination "assets\icon.ico" -Force
}

Write-Host "Compiling Launcher with icon..."
& $cscPath /target:winexe /out:RawasiAden.exe /win32icon:images\app.ico src_exe\Launcher.cs /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.dll

if ($LASTEXITCODE -eq 0) {
    # تشغيل نظام رواسي عدن.exe
    $arabicBytes = [byte[]]@(0xD8,0xAA,0xD8,0xB4,0xD8,0xBA,0xD9,0x8A,0xD9,0x84,0x20,0xD9,0x86,0xD8,0xB8,0xD8,0xA7,0xD9,0x85,0x20,0xD8,0xB1,0xD9,0x88,0xD8,0xA7,0xD8,0xB3,0xD9,0x8A,0x20,0xD8,0xB9,0xD8,0xAF,0xD9,0x86,0x2E,0x65,0x78,0x65)
    $arabicExeName = [System.Text.Encoding]::UTF8.GetString($arabicBytes)
    
    Copy-Item -LiteralPath "RawasiAden.exe" -Destination $arabicExeName -Force
    
    $desktop = [Environment]::GetFolderPath("Desktop")
    if ($desktop -and (Test-Path $desktop)) {
        $desktopTarget = [System.IO.Path]::Combine($desktop, $arabicExeName)
        Copy-Item -LiteralPath "RawasiAden.exe" -Destination $desktopTarget -Force
    }
    Write-Host "SUCCESS: Executable compiled and deployed successfully!"
} else {
    Write-Host "FAILED with exit code: $LASTEXITCODE"
}
