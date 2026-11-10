function Get-BackupDrillMavenInvocation {
    param([string]$Backend, [bool]$WindowsHost)
    if ($WindowsHost) {
        return [pscustomobject]@{ Command = (Join-Path $Backend 'mvnw.cmd'); Arguments = @() }
    }
    # The checked-in shell wrapper need not have an executable file mode.
    return [pscustomobject]@{ Command = 'sh'; Arguments = @((Join-Path $Backend 'mvnw')) }
}

function Invoke-WithBackupDrillCleanup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Action,
        [Parameter(Mandatory = $true)][scriptblock[]]$Cleanup
    )
    $primaryError = $null
    try { & $Action }
    catch {
        $primaryError = $_
        throw
    } finally {
        $firstCleanupError = $null
        foreach ($step in $Cleanup) {
            try { & $step }
            catch {
                if ($null -ne $primaryError -or $null -ne $firstCleanupError) {
                    # A caller's WarningPreference=Stop must not replace the pending error.
                    Write-Warning ("Backup drill cleanup also failed: " + $_.Exception.Message) -WarningAction Continue
                } else { $firstCleanupError = $_ }
            }
        }
        if ($null -eq $primaryError -and $null -ne $firstCleanupError) { throw $firstCleanupError }
    }
}

function Invoke-WithBackupDrillEnvironment {
    param([Parameter(Mandatory = $true)][scriptblock]$Action)
    $drillNames = @('PANTRYPAL_POSTGRES_BACKUP_DRILL', 'BACKUP_DRILL_USER', 'BACKUP_DRILL_PASSWORD',
        'BACKUP_DRILL_PG_BIN', 'BACKUP_DRILL_PORT')
    $original = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
    foreach ($entry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) {
        if ($entry.Key.StartsWith('PG', [StringComparison]::OrdinalIgnoreCase) -or $entry.Key -in $drillNames) {
            $original.Add($entry.Key, $entry.Value)
        }
    }
    try {
        # Clear before initdb/pg_ctl as well as libpq clients. A fixed list misses settings such as PGSSLMODE.
        foreach ($name in $original.Keys) {
            if ($name.StartsWith('PG', [StringComparison]::OrdinalIgnoreCase)) {
                [Environment]::SetEnvironmentVariable($name, $null, 'Process')
            }
        }
        & $Action
    } finally {
        # Also remove PG variables introduced by the drill, not just those present initially.
        foreach ($entry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) {
            if ($entry.Key.StartsWith('PG', [StringComparison]::OrdinalIgnoreCase) -or $entry.Key -in $drillNames) {
                [Environment]::SetEnvironmentVariable($entry.Key, $null, 'Process')
            }
        }
        foreach ($entry in $original.GetEnumerator()) {
            [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
        }
    }
}
