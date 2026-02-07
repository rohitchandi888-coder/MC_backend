# PostgreSQL Setup Script for FDA Wallet
# This script helps set up PostgreSQL for the FDA Wallet backend

Write-Host "=== FDA Wallet PostgreSQL Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check if PostgreSQL is installed
$pgPath = Get-ChildItem "C:\Program Files" -Filter "*PostgreSQL*" -Directory -ErrorAction SilentlyContinue | 
    Select-Object -First 1 -ExpandProperty FullName

if ($pgPath) {
    Write-Host "✅ PostgreSQL found at: $pgPath" -ForegroundColor Green
    
    # Try to find psql
    $psqlPath = Get-ChildItem -Path "$pgPath\*\bin\psql.exe" -Recurse -ErrorAction SilentlyContinue | 
        Select-Object -First 1 -ExpandProperty FullName
    
    if ($psqlPath) {
        Write-Host "✅ psql found at: $psqlPath" -ForegroundColor Green
        $env:Path += ";$(Split-Path $psqlPath)"
    }
} else {
    Write-Host "❌ PostgreSQL not found in standard location" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please choose an option:" -ForegroundColor Cyan
    Write-Host "1. Install PostgreSQL manually from: https://www.postgresql.org/download/windows/"
    Write-Host "2. Use Docker (if installed)"
    Write-Host ""
}

# Check Docker
$dockerAvailable = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerAvailable) {
    Write-Host "✅ Docker is available" -ForegroundColor Green
    Write-Host ""
    Write-Host "You can use Docker to run PostgreSQL:" -ForegroundColor Cyan
    Write-Host "  docker run --name postgres-fda -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fda_wallet -p 5432:5432 -d postgres"
    Write-Host ""
}

# Create .env file
$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
    Write-Host "Creating .env file..." -ForegroundColor Cyan
    $envContent = @"
PORT=4000
JWT_SECRET=your-secret-key-change-in-production

DB_HOST=localhost
DB_PORT=5432
DB_NAME=fda_wallet
DB_USER=postgres
DB_PASSWORD=postgres
"@
    Set-Content -Path $envPath -Value $envContent
    Write-Host "✅ .env file created at: $envPath" -ForegroundColor Green
} else {
    Write-Host "✅ .env file already exists" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host "1. Ensure PostgreSQL is running"
Write-Host "2. Create database: CREATE DATABASE fda_wallet;"
Write-Host "3. Update .env file with your PostgreSQL password if different"
Write-Host "4. Run: npm install"
Write-Host "5. Run: npm run dev"
Write-Host ""
