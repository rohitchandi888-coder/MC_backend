# FDA Transfer API Endpoint

## Endpoint URL
```
POST http://localhost:4000/api/fda/transfer-to-mc-wallet
```

## API Key
```
fda-mc-wallet-api-key-2024
```
*(You can change this by setting `FDA_API_KEY` in `.env` file)*

## Security Features
- ✅ Only accepts requests from `futuredigiassets.com` domain
- ✅ Requires API key authentication
- ✅ Validates user exists in MC Wallet before updating balance

## Request Headers
```
Content-Type: application/json
X-API-Key: fda-mc-wallet-api-key-2024
Origin: https://futuredigiassets.com
```

## Request Body
```json
{
  "userId": "89685",
  "amount": 100,
  "apiKey": "fda-mc-wallet-api-key-2024",
  "holdingPeriod": "13M"
}
```

**Note:** `holdingPeriod` is optional. If not provided, FDA will be available immediately.

### Parameters
- **userId** (required): User ID from FDA system (can be FDA user ID, email, or phone)
- **amount** (required): FDA amount to transfer (must be > 0)
- **apiKey** (required): API key for authentication
- **holdingPeriod** (optional): Lock period for the FDA amount (months only, any positive number)
  - **Format**: `"[NUMBER]M"` where NUMBER is any positive integer
  - **Examples**: 
    - `"1M"` = 1 month
    - `"6M"` = 6 months
    - `"13M"` = 13 months
    - `"24M"` = 24 months (2 years)
    - `"36M"` = 36 months (3 years)
    - `"60M"` = 60 months (5 years)
    - `"100M"` = 100 months
  - **Important**: Only months are supported. Years (e.g., "1Y", "2Y") are NOT allowed.
  - If not provided, FDA will be available immediately (no lock)

**Note:** API key can be provided either in:
- Header: `X-API-Key`
- Body: `apiKey` field
- Query: `?apiKey=...`

## PHP Example
```php
function transferFDAToMCWallet($userId, $amount, $holdingPeriod = null) {
    $apiKey = 'fda-mc-wallet-api-key-2024';
    $apiUrl = 'http://localhost:4000/api/fda/transfer-to-mc-wallet';
    
    $postData = [
        'userId' => $userId,
        'amount' => $amount,
        'apiKey' => $apiKey
    ];
    
    // Add holding period if provided (e.g., "1M", "6M", "13M", "36M")
    if ($holdingPeriod) {
        $postData['holdingPeriod'] = $holdingPeriod;
    }
    
    $ch = curl_init($apiUrl);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($postData));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'X-API-Key: ' . $apiKey,
        'Origin: https://futuredigiassets.com'
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    return [
        'status' => $httpCode === 200,
        'code' => $httpCode,
        'data' => json_decode($response, true)
    ];
}
```

## Success Response (200)
```json
{
  "success": true,
  "message": "FDA transferred successfully to MC Wallet",
  "user": {
    "localUserId": 9,
    "fdaUserId": "89685",
    "email": "garvgarg12@gmail.com",
    "phone": "7717345553"
  },
  "transfer": {
    "amount": 100,
    "oldBalance": 10.89,
    "newBalance": 110.89,
    "holdingPeriod": "13M",
    "expiresAt": "2025-02-28T12:00:00.000Z",
    "holdingId": 1
  },
  "timestamp": "2024-01-28T12:00:00.000Z"
}
```

## Error Responses

### User Not Found (404)
```json
{
  "error": "User not found in MC Wallet",
  "message": "User does not exist in MC Wallet. User must login first to be registered in the system.",
  "userId": "89685"
}
```

### Invalid API Key (401)
```json
{
  "error": "Invalid API key",
  "message": "The provided API key is not valid"
}
```

### Unauthorized Origin (403)
```json
{
  "error": "Unauthorized origin",
  "message": "This endpoint only accepts requests from futuredigiassets.com"
}
```

### Invalid Amount (400)
```json
{
  "error": "FDA amount must be greater than 0"
}
```

### Invalid Holding Period (400)
```json
{
  "error": "Invalid holding period format: 1Y. Must be in months format like \"1M\", \"6M\", \"13M\", \"36M\", etc. (only months are allowed, not years)"
}
```

or

```json
{
  "error": "Invalid holding period: 0M. Number of months must be greater than 0"
}
```

## Flow
1. ✅ Validates origin (must be from `futuredigiassets.com`)
2. ✅ Validates API key
3. ✅ Validates holding period (if provided)
4. ✅ Checks if user exists in MC Wallet
5. ❌ If user NOT exists → Returns error: "User not found in MC Wallet"
6. ✅ If user exists → Updates FDA balance in MC Wallet (adds amount)
7. ✅ If holding period provided → Creates holding record (locks FDA until expiration)

## Holding Period Feature

When `holdingPeriod` is provided, the FDA amount will be **locked** and cannot be used for:
- Creating SELL offers
- Internal transfers
- Any other transactions

The FDA will become available automatically after the holding period expires.

### Important Notes
- ✅ **Only months are supported** - Format: `"[NUMBER]M"` (e.g., "13M", "36M")
- ❌ **Years are NOT supported** - Do not use "1Y", "2Y", etc.
- ✅ **Any positive number of months is allowed** - 1, 6, 13, 14, 24, 36, 60, 100, etc.
- ✅ **FDA is locked until expiration** - Cannot be used for trades or transfers during holding period
- ✅ **Automatic unlock** - FDA becomes available automatically when holding period expires

### Example Holding Periods
| Format | Duration | Description |
|--------|----------|-------------|
| `"1M"` | 1 month | Short-term lock |
| `"6M"` | 6 months | Half year |
| `"13M"` | 13 months | Over 1 year |
| `"24M"` | 24 months | 2 years |
| `"36M"` | 36 months | 3 years |
| `"60M"` | 60 months | 5 years |
| `"100M"` | 100 months | Over 8 years |

**Any number of months is allowed** - Use whatever duration you need!

### Balance Calculation
- **Total Balance**: All FDA in account
- **Holding Locked**: FDA locked in holding periods (not expired)
- **Available**: Total - Locked in offers - Holding locked
- **Usable**: Available - Minimum holding requirement - Holding locked

## Environment Variable
Add to `backend/.env`:
```
FDA_API_KEY=fda-mc-wallet-api-key-2024
```
