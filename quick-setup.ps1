# Quick Setup Script for FDA Wallet Backend
# This script helps you set up PostgreSQL and create the .env file

Write-Host "`n=== FDA Wallet Backend Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check for PostgreSQL
$pgFound = $false
$pgPath = $null

$pgVersions = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue
if ($pgVersions) {
    $latest = $pgVersions | Sort-Object Name -Descending | Select-Object -First 1
    $psql = Get-ChildItem "$($latest.FullName)\bin\psql.exe" -ErrorAction SilentlyContinue
    if ($psql) {
        $pgFound = $true
        $pgPath = $psql.FullName
        Write-Host "✅ PostgreSQL found at: $($latest.FullName)" -ForegroundColor Green
    }
}

if (-not $pgFound) {
    Write-Host "❌ PostgreSQL not found" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please install PostgreSQL first:" -ForegroundColor Cyan
    Write-Host "1. Download from: https://www.postgresql.org/download/windows/"
    Write-Host "2. Install with default settings"
    Write-Host "3. Remember your postgres user password"
    Write-Host ""
    Write-Host "Or use Docker (if installed):" -ForegroundColor Cyan
    Write-Host "  docker run --name postgres-fda -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fda_wallet -p 5432:5432 -d postgres"
    Write-Host ""
}

# Create .env file
$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
    Write-Host "Creating .env file..." -ForegroundColor Cyan
    
    $dbPassword = "postgres"
    if ($pgFound) {
        Write-Host ""
        $customPassword = Read-Host "Enter your PostgreSQL password (or press Enter for 'postgres')"
        if ($customPassword) {
            $dbPassword = $customPassword
        }
    }
    
    $envContent = @"
PORT=4000
JWT_SECRET=your-secret-key-change-in-production

DB_HOST=localhost
DB_PORT=5432
DB_NAME=fda_wallet
DB_USER=postgres
DB_PASSWORD=$dbPassword
"@
    Set-Content -Path $envPath -Value $envContent
    Write-Host "✅ .env file created at: $envPath" -ForegroundColor Green
} else {
    Write-Host "✅ .env file already exists" -ForegroundColor Green
}

# Try to create database if PostgreSQL is found
if ($pgFound) {
    Write-Host ""
    Write-Host "Attempting to create database..." -ForegroundColor Cyan
    
    $createDb = Read-Host "Do you want to create the database now? (y/n)"
    if ($createDb -eq "y" -or $createDb -eq "Y") {
        $password = (Get-Content $envPath | Select-String "DB_PASSWORD=").ToString().Split("=")[1]
        
        try {
            $env:PGPASSWORD = $password
            & $pgPath -U postgres -c "CREATE DATABASE fda_wallet;" 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ Database 'fda_wallet' created successfully!" -ForegroundColor Green
            } else {
                Write-Host "⚠️  Database might already exist or there was an error" -ForegroundColor Yellow
                Write-Host "   You can create it manually using pgAdmin or psql" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "⚠️  Could not create database automatically" -ForegroundColor Yellow
            Write-Host "   Please create it manually:" -ForegroundColor Yellow
            Write-Host "   1. Open pgAdmin or psql" -ForegroundColor Yellow
            Write-Host "   2. Run: CREATE DATABASE fda_wallet;" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host "1. Ensure PostgreSQL service is running"
Write-Host "2. Ensure database 'fda_wallet' exists"
Write-Host "3. Install dependencies: npm install"
Write-Host "4. Start server: npm run dev"
Write-Host ""
Write-Host "For detailed instructions, see: SETUP_POSTGRES.md" -ForegroundColor Cyan
Write-Host ""
