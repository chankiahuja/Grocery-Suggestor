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
Invoke-WithBackupDrillEnvironment -Action {
    $env:PGSSLMODE = 'require'
    $checkRoot = Join-Path $backend 'target/backup-cleanup-checks'
    New-Item -ItemType Directory -Path $checkRoot -Force | Out-Null
    foreach ($failDrill in @($false, $true)) {
        foreach ($failStop in @($false, $true)) {
            $passwordPath = Join-Path $checkRoot ([guid]::NewGuid().ToString('N') + '.txt')
            [IO.File]::WriteAllText($passwordPath, 'synthetic-test-password')
            $steps = New-Object 'System.Collections.Generic.List[string]'
            $primary = New-Object System.Exception('Backup drill failed; inspect the test report and ignored tool logs')
            $caught = $null
            $observed = @{ Warnings = @() }
            $previousWarningPreference = $WarningPreference
            try {
                $WarningPreference = 'Stop'
                Invoke-WithBackupDrillEnvironment -Action {
                    $env:PGPASSWORD = 'temporary-test-value'
                    try {
                        Invoke-WithBackupDrillCleanup -Action {
                            $steps.Add('maven')
                            if ($failDrill) { throw $primary }
                        } -Cleanup @({
                            $steps.Add('stop')
                            if ($failStop) { throw 'Could not stop the isolated drill cluster' }
                        }, {
                            $steps.Add('password')
                            Remove-Item -LiteralPath $passwordPath
                        }) -WarningVariable cleanupWarnings
                    } finally { $observed.Warnings = @($cleanupWarnings) }
                }
            } catch { $caught = $_ }
            finally { $WarningPreference = $previousWarningPreference }
            if ($failDrill) {
                Assert-DrillCheck ($null -ne $caught -and [object]::ReferenceEquals($caught.Exception, $primary)) 'Cleanup replaced the primary Maven error'
            } elseif ($failStop) {
                Assert-DrillCheck ($null -ne $caught -and $caught.Exception.Message -eq 'Could not stop the isolated drill cluster') 'Stop-only failure did not fail the drill'
            } else { Assert-DrillCheck ($null -eq $caught) "Unexpected cleanup failure: $caught" }
            Assert-DrillCheck (($steps -join ',') -eq 'maven,stop,password') 'Cleanup did not attempt every step'
            Assert-DrillCheck ($observed.Warnings.Count -eq [int]($failDrill -and $failStop)) 'Combined failure did not emit the expected cleanup warning'
            Assert-DrillCheck (-not (Test-Path -LiteralPath $passwordPath)) 'Password file was not removed after failure'
            Assert-DrillCheck ($env:PGSSLMODE -eq 'require' -and $null -eq $env:PGPASSWORD) 'Environment was not restored after cleanup'
        }
    }
}
Write-Output 'Passed: wrapper selection, environment restoration and drill/stop failure combinations (including WarningPreference=Stop).'
