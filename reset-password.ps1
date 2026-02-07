# PostgreSQL Password Reset Helper
# This script helps you reset or verify your PostgreSQL password

Write-Host "=== PostgreSQL Password Helper ===" -ForegroundColor Cyan
Write-Host ""

$psqlPath = "C:\Program Files\PostgreSQL\18\bin\psql.exe"

if (-not (Test-Path $psqlPath)) {
    Write-Host "❌ PostgreSQL not found at expected location" -ForegroundColor Red
    exit
}

Write-Host "Options:" -ForegroundColor Yellow
Write-Host "1. Try to connect with password 'mcwallet'"
Write-Host "2. Try to connect with password 'postgres' (default)"
Write-Host "3. Try to connect with no password"
Write-Host "4. Open pgAdmin to check the password"
Write-Host "5. Reset password (requires admin access)"
Write-Host ""

$choice = Read-Host "Enter your choice (1-5)"

switch ($choice) {
    "1" {
        Write-Host "Testing with password 'mcwallet'..." -ForegroundColor Cyan
        $env:PGPASSWORD = "mcwallet"
        & $psqlPath -U postgres -c "SELECT version();" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Password 'mcwallet' works!" -ForegroundColor Green
        } else {
            Write-Host "❌ Password 'mcwallet' doesn't work" -ForegroundColor Red
        }
    }
    "2" {
        Write-Host "Testing with password 'postgres'..." -ForegroundColor Cyan
        $env:PGPASSWORD = "postgres"
        & $psqlPath -U postgres -c "SELECT version();" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Password 'postgres' works!" -ForegroundColor Green
            Write-Host "Updating .env file..." -ForegroundColor Cyan
            (Get-Content .env) -replace 'DB_PASSWORD=.*', 'DB_PASSWORD=postgres' | Set-Content .env
            Write-Host "✅ .env file updated!" -ForegroundColor Green
        } else {
            Write-Host "❌ Password 'postgres' doesn't work" -ForegroundColor Red
        }
    }
    "3" {
        Write-Host "Testing with no password..." -ForegroundColor Cyan
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
        & $psqlPath -U postgres -c "SELECT version();" 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ No password works!" -ForegroundColor Green
            Write-Host "Updating .env file..." -ForegroundColor Cyan
            (Get-Content .env) -replace 'DB_PASSWORD=.*', 'DB_PASSWORD=' | Set-Content .env
            Write-Host "✅ .env file updated!" -ForegroundColor Green
        } else {
            Write-Host "❌ No password doesn't work" -ForegroundColor Red
        }
    }
    "4" {
        Write-Host "Opening pgAdmin..." -ForegroundColor Cyan
        Write-Host ""
        Write-Host "In pgAdmin:" -ForegroundColor Yellow
        Write-Host "1. Connect to your PostgreSQL server"
        Write-Host "2. Right-click server → Properties → Connection tab"
        Write-Host "3. Check what password is saved there"
        Write-Host "4. Come back and tell me the password"
        Write-Host ""
        Start-Process "pgAdmin 4" -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    "5" {
        Write-Host ""
        Write-Host "To reset password, you need to:" -ForegroundColor Yellow
        Write-Host "1. Edit pg_hba.conf (temporarily allow trust)"
        Write-Host "2. Restart PostgreSQL service"
        Write-Host "3. Connect and change password"
        Write-Host "4. Revert pg_hba.conf"
        Write-Host ""
        Write-Host "Location: C:\Program Files\PostgreSQL\18\data\pg_hba.conf" -ForegroundColor Cyan
        Write-Host ""
        $open = Read-Host "Do you want detailed instructions? (y/n)"
        if ($open -eq "y") {
            Write-Host ""
            Write-Host "=== Password Reset Steps ===" -ForegroundColor Cyan
            Write-Host "1. Open: C:\Program Files\PostgreSQL\18\data\pg_hba.conf"
            Write-Host "2. Find: host all all 127.0.0.1/32 scram-sha-256"
            Write-Host "3. Change to: host all all 127.0.0.1/32 trust"
            Write-Host "4. Save file"
            Write-Host "5. Restart PostgreSQL service (services.msc)"
            Write-Host "6. Run: .\psql.exe -U postgres"
            Write-Host "7. Run: ALTER USER postgres PASSWORD 'mcwallet';"
            Write-Host "8. Revert pg_hba.conf back to scram-sha-256"
            Write-Host "9. Restart PostgreSQL service again"
            Write-Host ""
        }
    }
    default {
        Write-Host "Invalid choice" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "After finding the correct password, update .env file and run: npm run dev" -ForegroundColor Cyan
