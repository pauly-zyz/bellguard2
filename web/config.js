// Network and contract addresses for the app.
// After running contracts/script/DeployTestnetDemo.s.sol, copy the addresses from
// contracts/deployments/demo-46630.json into `deployment` below.
window.BELLGUARD_CONFIG = {
  defaultChainId: 46630,
  chains: {
    46630: {
      name: "Robinhood Chain Testnet",
      rpc: "https://rpc.testnet.chain.robinhood.com",
      deployment: null,
      // Example shape:
      // deployment: {
      //   usdg: "0x…", stock: "0x…", stockSymbol: "dTSLA", calendar: "0x…",
      //   vault: "0x…", hook: "0x…", claims: "0x…",
      //   pool: { currency0: "0x…", currency1: "0x…", fee: 3000, tickSpacing: 60, hooks: "0x…" }
      // }
    },
    4663: {
      name: "Robinhood Chain",
      rpc: "https://rpc.mainnet.chain.robinhood.com",
      deployment: null, // not deployed: needs audit, legal review and a multisig first
    },
  },
};
