// Bellguard Perps (long/short stock prices) on Elysium mainnet, collateral USDC.
// `deployment` comes from contracts/deployments/perps-99901.json once deployed; until then the
// Trade page runs as a live preview with Chainlink prices from the source chain.
window.BELLGUARD_PERPS = {
  chainId: 99901,
  chain: {
    name: "Elysium",
    rpc: "https://rpc.elysium.kinetiq.xyz",
    relay: "/api/rpc?chain=99901",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    explorer: "https://elysium.kinetiq.xyz",
  },
  collateralSymbol: "USDC",
  owner: "0x4b08C1DbE28e4e260037299e8cb4B34c7FBe2195",
  // Where preview prices and charts come from (Chainlink feeds).
  source: { chainId: 4663, rpc: "https://rpc.mainnet.chain.robinhood.com", relay: "/api/rpc?chain=4663", multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  deployment: null,
  markets: [
    {
      "symbol": "TSLA",
      "name": "Tesla",
      "sourceFeed": "0xE4479F01738B4e8C428CD8eB72D47AB9BC3c7de6",
      "logo": "logos/TSLA.png"
    },
    {
      "symbol": "NVDA",
      "name": "NVIDIA",
      "sourceFeed": "0xCF169363636D73dbBf77733629CB38919d14232d",
      "logo": "logos/NVDA.png"
    },
    {
      "symbol": "AAPL",
      "name": "Apple",
      "sourceFeed": "0x4bDbb3150014c6Ab2C6D9347B0779c49015a2f3f",
      "logo": "logos/AAPL.png"
    },
    {
      "symbol": "AMZN",
      "name": "Amazon",
      "sourceFeed": "0x9244830430bC7D9C9A48dd47603F24AD61f7c56e",
      "logo": "logos/AMZN.png"
    },
    {
      "symbol": "GOOGL",
      "name": "Alphabet",
      "sourceFeed": "0xA04EE5c4c8827F17e82f93bE9e19DeA221A749a8",
      "logo": "logos/GOOGL.png"
    },
    {
      "symbol": "META",
      "name": "Meta",
      "sourceFeed": "0x5cBC53D382E56cBb223f118CF8Eefb6c9c2759f5",
      "logo": "logos/META.png"
    },
    {
      "symbol": "MSFT",
      "name": "Microsoft",
      "sourceFeed": "0xaD6D88eab22aa4867Efe807a5311Ed64962f740D",
      "logo": "logos/MSFT.png"
    },
    {
      "symbol": "PLTR",
      "name": "Palantir",
      "sourceFeed": "0x8cd1DFC0fc61fcA55FA77b37e008A90f13364Fce",
      "logo": "logos/PLTR.png"
    },
    {
      "symbol": "COIN",
      "name": "Coinbase",
      "sourceFeed": "0xA7F7D79D578fb007384BaDF42c8E1D76a6a63bBD",
      "logo": "logos/COIN.png"
    },
    {
      "symbol": "MSTR",
      "name": "Strategy",
      "sourceFeed": "0x2521a77F42098357e83bDea7fBb2A38745bf9280",
      "logo": "logos/MSTR.png"
    },
    {
      "symbol": "SPY",
      "name": "S&P 500 ETF",
      "sourceFeed": "0xa68CA83408bE3f78d1c58a82081c619e9d21486d",
      "type": "ETF"
    },
    {
      "symbol": "QQQ",
      "name": "Nasdaq-100 ETF",
      "sourceFeed": "0x41ed2c58611790af0760e31e80Bb427e4e83D603",
      "type": "ETF"
    }
  ],
};
