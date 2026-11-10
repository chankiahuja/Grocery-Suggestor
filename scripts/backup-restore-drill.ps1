param(
    [Parameter(Mandatory = $true)]
    [string]$PostgresBin
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-drill-support.ps1')
$windowsHost = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$backend = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../backend'))
$maven = Get-BackupDrillMavenInvocation -Backend $backend -WindowsHost $windowsHost
$runRoot = Join-Path $backend ('target/backup-cluster/' + [guid]::NewGuid().ToString('N'))
$data = Join-Path $runRoot 'data'
$passwordFile = Join-Path $runRoot 'disposable-password.txt'
$serverLog = Join-Path $runRoot 'postgres.log'
$tools = @{}
foreach ($name in @('initdb', 'pg_ctl', 'createdb', 'pg_dump', 'pg_restore')) {
    $extension = if ($windowsHost) { '.exe' } else { '' }
    $tools[$name] = Join-Path $PostgresBin ($name + $extension)
    if (-not (Test-Path -LiteralPath $tools[$name] -PathType Leaf)) { throw "Missing PostgreSQL tool: $name" }
}

# This cluster contains only generated synthetic data and has no link to the installed app database.
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
$disposablePassword = [guid]::NewGuid().ToString('N')
[IO.File]::WriteAllText($passwordFile, $disposablePassword, (New-Object Text.UTF8Encoding($false)))
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()

Invoke-WithBackupDrillEnvironment -Action {
    $startAttempted = $false
    try {
        & $tools['initdb'] -D $data --username=drill_operator --auth=scram-sha-256 --encoding=UTF8 --no-locale "--pwfile=$passwordFile"
        if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL initialization failed' }
        $startAttempted = $true
        & $tools['pg_ctl'] -D $data -l $serverLog -o "-h 127.0.0.1 -p $port" -w start
        if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL startup was not confirmed; inspect its ignored log' }
        $env:PGPASSWORD = $disposablePassword
        $env:PGCONNECT_TIMEOUT = '5'
        & $tools['createdb'] -h 127.0.0.1 -p $port -U drill_operator --no-password pantrypal_auth_test
        if ($LASTEXITCODE -ne 0) { throw 'Isolated administration database creation failed' }
        $env:PANTRYPAL_POSTGRES_BACKUP_DRILL = 'true'
        $env:BACKUP_DRILL_USER = 'drill_operator'
        $env:BACKUP_DRILL_PASSWORD = $disposablePassword
        $env:BACKUP_DRILL_PG_BIN = [IO.Path]::GetFullPath($PostgresBin)
        $env:BACKUP_DRILL_PORT = [string]$port
        Push-Location $backend
        try {
            $mavenArguments = @($maven.Arguments) + @('-Dtest=PostgresBackupRestoreDrillTest', 'test')
            & $maven.Command @mavenArguments
            if ($LASTEXITCODE -ne 0) { throw 'Backup drill failed; inspect the test report and ignored tool logs' }
        } finally { Pop-Location }
    } finally {
        $stopFailed = $false
        if ($startAttempted) {
            & $tools['pg_ctl'] -D $data status
            if ($LASTEXITCODE -eq 0) {
                & $tools['pg_ctl'] -D $data -m fast -w stop
                $stopFailed = $LASTEXITCODE -ne 0
            }
        }
        if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile }
        if ($stopFailed) { throw 'Could not stop the isolated drill cluster; inspect its pg_ctl status before cleanup' }
    }
}
Write-Output 'Backup drill passed; its isolated PostgreSQL cluster has stopped.'
