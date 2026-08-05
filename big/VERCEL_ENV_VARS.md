# Vercel Environment Variables

Set these environment variables in your Vercel project settings:

## Required Environment Variables

### 1. Contract Address (Mainnet)
```
NEXT_PUBLIC_CONTRACT_ADDRESS=0x307375c13192810bDB240C055a20B78e7D50D1ae
```
- **Type:** Plain Text
- **Environment:** Production, Preview, Development
- **Description:** Polygon mainnet contract address (proxy)

### 2. WalletConnect Project ID
```
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=40be7de0d2331dbad2baa537262e304c
```
- **Type:** Plain Text
- **Environment:** Production, Preview, Development
- **Description:** WalletConnect project ID for wallet connections

## How to Set in Vercel

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add each variable:
   - Click **Add New**
   - Enter the variable name
   - Enter the value
   - Select environments (Production, Preview, Development)
   - Click **Save**
4. Redeploy your application after adding variables

## Network Configuration

The frontend is configured to use **Polygon Mainnet** (Chain ID: 137).

## Verification

After setting the variables and redeploying:
1. Check that the contract address is correct on the homepage
2. Test wallet connection (should connect to Polygon mainnet)
3. Verify transactions appear on [Polygonscan](https://polygonscan.com)

