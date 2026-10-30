# Website end-to-end test

Runs the real site in Chromium with a test wallet against a local anvil chain that has the
full Bellguard demo deployed, then clicks through every flow: deposit, withdraw (open and
locked), closed-market premiums, settlement, claim check, claim registration, payout, plus
the landing page chart and clock. Results are verified on-chain. The last run passed 21/21 checks.

```bash
# 1. Local chain with a v4 PoolManager and the demo
anvil --port 8545 --chain-id 31337 &
cd contracts
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil account 0
forge create lib/v4-core/src/PoolManager.sol:PoolManager --rpc-url http://127.0.0.1:8545 \
  --private-key $KEY --broadcast --constructor-args 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
POOL_MANAGER=<address from above> WINDOWS_JSON=script/windows-2026-11-to-2027-02.json \
  forge script script/DeployTestnetDemo.s.sol:DeployTestnetDemo --rpc-url http://127.0.0.1:8545 \
  --private-key $KEY --broadcast --slow

# 2. Serve the site and run the test
cd ../web && python -m http.server 8766 --bind 127.0.0.1 &
cd test && npm install && npx playwright install chromium && npm run e2e
```

The test moves the chain clock (weekend of 2026-10-31), so restart anvil before running it again.
