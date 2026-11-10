$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'backup-drill-support.ps1')
function Assert-DrillCheck([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

$backend = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../backend'))
$windowsCommand = Get-BackupDrillMavenInvocation -Backend $backend -WindowsHost $true
Assert-DrillCheck ($windowsCommand.Command -eq (Join-Path $backend 'mvnw.cmd')) 'Wrong Windows wrapper'
Assert-DrillCheck ($windowsCommand.Arguments.Count -eq 0) 'Unexpected Windows wrapper arguments'
$unixCommand = Get-BackupDrillMavenInvocation -Backend $backend -WindowsHost $false
Assert-DrillCheck ($unixCommand.Command -eq 'sh') 'Non-Windows wrapper must use sh'
Assert-DrillCheck ($unixCommand.Arguments.Count -eq 1 -and $unixCommand.Arguments[0] -eq (Join-Path $backend 'mvnw')) 'Wrong shell wrapper path'

# Save the caller's environment as well: these checks must not leave their synthetic settings behind.
Invoke-WithBackupDrillEnvironment -Action {
    $env:PGSSLMODE = 'require'
    $env:PGSERVICE = 'synthetic-service-must-not-be-used'
    $env:PG_DRILL_SENTINEL = 'original-value'
    $env:BACKUP_DRILL_USER = 'original-user'
    foreach ($fail in @($false, $true)) {
        $caught = $null
        try {
            Invoke-WithBackupDrillEnvironment -Action {
                $pgNames = @([Environment]::GetEnvironmentVariables('Process').Keys | Where-Object { $_ -like 'PG*' })
                Assert-DrillCheck ($pgNames.Count -eq 0) 'Inherited PostgreSQL variables were not cleared before the action'
                $env:PGPASSWORD = 'synthetic-password'
                $env:PG_NEW_DRILL_VALUE = 'must-be-removed'
                $env:BACKUP_DRILL_USER = 'temporary-user'
                if ($fail) { throw 'synthetic setup failure' }
            }
        } catch { $caught = $_ }
        if ($fail) {
            Assert-DrillCheck ($null -ne $caught -and $caught.Exception.Message -eq 'synthetic setup failure') 'Primary failure was not preserved'
        } else {
            Assert-DrillCheck ($null -eq $caught) "Unexpected failure: $caught"
        }
        Assert-DrillCheck ($env:PGSSLMODE -eq 'require') 'PGSSLMODE was not restored'
        Assert-DrillCheck ($env:PGSERVICE -eq 'synthetic-service-must-not-be-used') 'PGSERVICE was not restored'
        Assert-DrillCheck ($env:PG_DRILL_SENTINEL -eq 'original-value') 'Unlisted inherited PG variable was not restored'
        Assert-DrillCheck ($env:BACKUP_DRILL_USER -eq 'original-user') 'Drill variable was not restored'
        Assert-DrillCheck ($null -eq $env:PGPASSWORD -and $null -eq $env:PG_NEW_DRILL_VALUE) 'New PostgreSQL variables leaked'
    }
}
Write-Output 'Passed: Windows/non-Windows Maven selection and environment restoration after success/failure.'
